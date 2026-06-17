// sync.js — 登录后的跨设备同步(本地优先 + 去抖上行 + LWW)。见 user-system-design §6。
// 未登录/无后端时本模块不参与,前端纯本地运行。
import { api, isLoggedIn } from './session.js';
import { createStore, getUserMeta } from './store.js';

const GUEST_META_KEY = 'pglib:u:local:__meta';
const DEBOUNCE_MS = 1200;

let onApplied = null;        // 远端数据落地后的 UI 刷新回调
let serverMap = {};          // "course:slot" -> server updated_at(pull 时建立)
const pending = new Map();   // 待上行 "course:slot" -> {courseId, slot}
let flushTimer = null;

function splitKey(composite) {
  const i = composite.lastIndexOf(':');
  return { courseId: composite.slice(0, i), slot: composite.slice(i + 1) };
}

// 拉取该用户全部远端状态,server 新者写入本地;返回 server 的 ts 映射。
async function pullMerge() {
  const r = await api('GET', '/sync');
  serverMap = {};
  if (!r.ok || !Array.isArray(r.json?.states)) return;
  let appliedAny = false;
  for (const s of r.json.states) {
    const key = `${s.course_id}:${s.slot}`;
    serverMap[key] = s.updated_at;
    const st = createStore(s.course_id);
    if (s.updated_at > st.getMetaTs(s.slot)) {
      st.setRemote(s.slot, s.data, s.updated_at);
      appliedAny = true;
    }
  }
  if (appliedAny && onApplied) onApplied();
}

// 访客档案并入账户:账户里没有、访客里有的 slot,作为初始值写入账户(随后上行)。
function seedFromGuest() {
  let guestMeta = {};
  try { guestMeta = JSON.parse(localStorage.getItem(GUEST_META_KEY) || '{}'); } catch { guestMeta = {}; }
  for (const composite of Object.keys(guestMeta)) {
    const { courseId, slot } = splitKey(composite);
    const acct = createStore(courseId);
    if (acct.getMetaTs(slot)) continue;            // 账户已有该 slot(已 pull 或本就有)→ 跳过
    const raw = localStorage.getItem(`pglib:u:local:${courseId}:${slot}`);
    if (raw == null) continue;
    let val = null;
    try { val = JSON.parse(raw); } catch { continue; }
    acct.set(slot, val);                           // 写账户 + 标记 now(会进上行队列)
  }
}

// 把本地比 server 新(或 server 没有)的 slot 全部上行。
async function pushLocalNewer() {
  const meta = getUserMeta();
  for (const key of Object.keys(meta)) {
    if ((meta[key] || 0) > (serverMap[key] || 0)) {
      const { courseId, slot } = splitKey(key);
      await pushOne(courseId, slot);
    }
  }
}

async function pushOne(courseId, slot) {
  const st = createStore(courseId);
  const data = st.get(slot, null);
  const updated_at = st.getMetaTs(slot);
  if (!updated_at) return;
  const r = await api('PUT', `/state/${encodeURIComponent(courseId)}/${encodeURIComponent(slot)}`, { data, updated_at });
  if (r.ok && r.json) {
    if (r.json.applied === false) {
      // 远端更近(并发写):取回远端版本合并到本地。
      st.setRemote(slot, r.json.data, r.json.updated_at);
      serverMap[`${courseId}:${slot}`] = r.json.updated_at;
      if (onApplied) onApplied();
    } else {
      serverMap[`${courseId}:${slot}`] = r.json.updated_at;
    }
  }
  // 网络失败:保留在 meta 中,下次写入或下次启动再补传。
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    const items = [...pending.values()];
    pending.clear();
    for (const { courseId, slot } of items) await pushOne(courseId, slot);
  }, DEBOUNCE_MS);
}

function onStoreSet(e) {
  const { courseId, slot } = e.detail || {};
  if (!courseId || !slot) return;
  pending.set(`${courseId}:${slot}`, { courseId, slot });
  scheduleFlush();
}

/** 启动同步。登录态才工作:pull→seed→push,并订阅后续本地变更去抖上行。 */
export async function initSync(opts = {}) {
  onApplied = opts.onApplied || null;
  if (!isLoggedIn()) return;
  await pullMerge();
  seedFromGuest();
  await pushLocalNewer();
  window.addEventListener('pglib:store-set', onStoreSet);
}
