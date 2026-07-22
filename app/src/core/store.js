// store.js — 按「用户 × 课程」分命名空间的 localStorage 封装。
//
// 历史:原站把进度/答题/错题/时长写在全局 key,多课程互相串号。
// 第一版改成 pglib:<courseId>:<slot> 按课程隔离。
// 本版再加一层「用户」维度,支持可选的跨设备同步(见 docs/user-system-design.md):
//   课程级:pglib:u:<uid|local>:<courseId>:<slot>
//   未登录 = 字面量 'local'(本地/访客档案,等同旧行为,可离线)。
//   登录后 = 用户 id。登录/登出会重载页面,故 store 创建时即反映当前用户。
//
// 站点级偏好(theme / lastCourse 等)仍走 globalGet/globalSet,不分用户、不分课程。
//
// 为支持同步,set() 会为该 (course,slot) 记一个 updated_at(存在用户级 __meta),
// 并派发 'pglib:store-set' 事件;sync.js 监听后去抖上行(本地优先,永不阻塞 UI)。

const PREFIX = 'pglib';

let activeUserId = 'local';

/** 设置当前活跃用户命名空间('local' = 访客)。由 session.js 在 store 创建前调用。 */
export function setActiveUser(id) {
  activeUserId = id == null ? 'local' : String(id);
}
export function getActiveUser() {
  return activeUserId;
}

/** 站点级(不分用户/课程)读写,用于主题、续学记录等全局偏好。 */
export function globalGet(key, fallback) {
  try {
    const v = localStorage.getItem(`${PREFIX}:${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export function globalSet(key, val) {
  try {
    localStorage.setItem(`${PREFIX}:${key}`, JSON.stringify(val));
  } catch {
    /* 全局偏好写失败可忽略 */
  }
}

// ---- 用户级 __meta(记录每 (course,slot) 的 updated_at,供同步 LWW)----
function metaKey() {
  return `${PREFIX}:u:${activeUserId}:__meta`;
}
function readMeta() {
  try {
    return JSON.parse(localStorage.getItem(metaKey()) || '{}');
  } catch {
    return {};
  }
}
function writeMeta(meta) {
  try {
    localStorage.setItem(metaKey(), JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}
/** 当前活跃用户的全部 (course:slot)→updated_at 映射(供 sync 枚举本地变更)。 */
export function getUserMeta() {
  return readMeta();
}

// ---- 一次性迁移:旧的 pglib:<courseId>:<slot> → pglib:u:local:<courseId>:<slot> ----
function migrateLegacyKeys() {
  try {
    if (localStorage.getItem(`${PREFIX}:migrated`)) return;
    const legacy = /^pglib:([^:]+):(progress|quiz|wrong|studyTime)$/;
    const moves = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const m = key && key.match(legacy);
      if (m && m[1] !== 'u') moves.push({ key, courseId: m[1], slot: m[2] });
    }
    const meta = {};
    for (const { key, courseId, slot } of moves) {
      const val = localStorage.getItem(key);
      localStorage.setItem(`${PREFIX}:u:local:${courseId}:${slot}`, val);
      localStorage.removeItem(key);
      meta[`${courseId}:${slot}`] = Date.now(); // 标记为新,登录后可上行
    }
    if (moves.length) {
      const cur = (() => { try { return JSON.parse(localStorage.getItem(`${PREFIX}:u:local:__meta`) || '{}'); } catch { return {}; } })();
      localStorage.setItem(`${PREFIX}:u:local:__meta`, JSON.stringify({ ...cur, ...meta }));
    }
    localStorage.setItem(`${PREFIX}:migrated`, '1');
  } catch {
    /* 迁移失败不致命:大不了按未迁移处理 */
  }
}
migrateLegacyKeys();

// 清除浏览器中可能遗留的访客缓存(pglib:u:local:*)。访客进度不持久化,旧版可能写过数据。
function purgeGuestData() {
  try {
    const prefix = `${PREFIX}:u:local:`;
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
purgeGuestData();

/**
 * 创建某门课程在当前用户命名空间下的存储。slot 逻辑分区:
 *   progress  知识点掌握状态 {kpId: 'mastered'|'read'|''}
 *   quiz      小节小测结果 {qid: {ans, correct, t}}
 *   wrong     错题本 [...]
 *   studyTime 累计学习时长(ms)
 *   exams     章节考试成绩档 [{chapter,total,correct,score,t}](仅汇总,最近 50 次)
 */
export function createStore(courseId) {
  const ns = `${PREFIX}:u:${activeUserId}:${courseId}`;
  const keyOf = (slot) => `${ns}:${slot}`;
  const sessionState = {};

  // 配额溢出时,按重要性从低到高回收当前课程的数据,腾出空间后重试。
  const RECLAIM_ORDER = ['wrong', 'quiz'];
  function reclaimAndRetry(targetSlot, raw) {
    for (const slot of RECLAIM_ORDER) {
      if (slot === targetSlot) continue;
      const k = keyOf(slot);
      if (localStorage.getItem(k) == null) continue;
      try {
        localStorage.removeItem(k);
        localStorage.setItem(keyOf(targetSlot), raw);
        return true;
      } catch {
        /* 继续回收下一个 slot */
      }
    }
    return false;
  }

  function stamp(slot, ts) {
    const meta = readMeta();
    meta[`${courseId}:${slot}`] = ts;
    writeMeta(meta);
  }

  function writeRaw(slot, raw) {
    try {
      localStorage.setItem(keyOf(slot), raw);
      return true;
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
        return reclaimAndRetry(slot, raw);
      }
      return false;
    }
  }

  return {
    courseId,
    get(slot, fallback) {
      // 访客只保留当前页面会话,不写入 localStorage。
      if (activeUserId === 'local') {
        return Object.hasOwn(sessionState, slot) ? sessionState[slot] : fallback;
      }
      try {
        const v = localStorage.getItem(keyOf(slot));
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    },
    // 用户发起的写:本地写 + 记 updated_at=now + 派发事件(供 sync 上行)。访客不持久化。
    set(slot, val) {
      if (activeUserId === 'local') {
        sessionState[slot] = val;
        return;
      }
      const at = Date.now();
      if (writeRaw(slot, JSON.stringify(val))) {
        stamp(slot, at);
        try {
          window.dispatchEvent(new CustomEvent('pglib:store-set', { detail: { courseId, slot, updatedAt: at } }));
        } catch { /* 非浏览器环境忽略 */ }
      }
    },
    // 来自远端同步的写:本地写 + 记给定 ts,但不派发事件(避免回声上行)。
    setRemote(slot, val, ts) {
      if (writeRaw(slot, JSON.stringify(val))) stamp(slot, ts);
    },
    getMetaTs(slot) {
      return readMeta()[`${courseId}:${slot}`] || 0;
    },
    remove(slot) {
      if (activeUserId === 'local') {
        delete sessionState[slot];
        return;
      }
      try {
        localStorage.removeItem(keyOf(slot));
        const meta = readMeta();
        delete meta[`${courseId}:${slot}`];
        writeMeta(meta);
      } catch {
        /* ignore */
      }
    },
    /** 清空本课程全部数据(只清当前用户命名空间)。 */
    clear() {
      ['progress', 'quiz', 'wrong', 'studyTime', 'exams'].forEach((s) => this.remove(s));
    },
  };
}
