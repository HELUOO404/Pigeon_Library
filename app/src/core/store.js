// store.js — 按课程 ID 分命名空间的 localStorage 封装。
//
// 原站把进度/答题/错题/学习时长都写在全局 key(ic_progress 等),
// 多课程会互相串号。这里改成 pglib:<courseId>:<slot>,课程之间彻底隔离。
// 主题(theme)是站点级偏好,不分课程,见 theme.js。
//
// 同时修复原站 safeSet 的配额回收 bug:原代码无论写哪个 key,
// 配额溢出时都只删 ic_reviews 的第一条,删复习模块后这段逻辑彻底失效。
// 这里改为回收「当前课程命名空间」里最不重要的数据(先错题、再答题记录)。

const PREFIX = 'pglib';

/** 站点级(不分课程)读写,用于主题等全局偏好。 */
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

/**
 * 创建某门课程的命名空间存储。slot 为逻辑分区:
 *   progress  知识点掌握状态 {kpId: 'mastered'|'read'|''}
 *   quiz      小节小测结果 {qid: {ans, correct, t}}
 *   wrong     错题本 [{id, type, chapter, question, options, answer, yourAnswer, explain, ...}]
 *   studyTime 累计学习时长(ms)
 */
export function createStore(courseId) {
  const ns = `${PREFIX}:${courseId}`;
  const keyOf = (slot) => `${ns}:${slot}`;

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

  return {
    courseId,
    get(slot, fallback) {
      try {
        const v = localStorage.getItem(keyOf(slot));
        return v ? JSON.parse(v) : fallback;
      } catch {
        return fallback;
      }
    },
    set(slot, val) {
      const raw = JSON.stringify(val);
      try {
        localStorage.setItem(keyOf(slot), raw);
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          reclaimAndRetry(slot, raw);
        }
      }
    },
    remove(slot) {
      try {
        localStorage.removeItem(keyOf(slot));
      } catch {
        /* ignore */
      }
    },
    /** 清空本课程全部数据(对应原 resetProgress,但只清当前课程)。 */
    clear() {
      ['progress', 'quiz', 'wrong', 'studyTime'].forEach((s) => this.remove(s));
    },
  };
}
