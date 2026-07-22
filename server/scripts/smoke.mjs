// smoke.mjs — 后端冒烟测试:注册→登录→state(LWW)→sync→admin 守卫→登出,并断言密码不落明文。
// 用法:先 `npm start`(另开终端),再 `npm run smoke`。或设 BASE 环境变量指向已起服务。
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:8787';
const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(here, '..', 'data', 'pglib.db');

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}  ${extra}`); }
}

// 带 cookie jar 的 fetch 封装。
function makeClient() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(BASE + url, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setC = res.headers.get('set-cookie');
    if (setC) cookie = setC.split(';')[0];
    let json = null;
    try { json = await res.json(); } catch { /* 204 等无体 */ }
    return { status: res.status, json, cookie };
  };
}

const uniq = Date.now().toString(36);
const A = { username: `smokeA_${uniq}`, password: 'pw-A-12345' };
const B = { username: `smokeB_${uniq}`, password: 'pw-B-12345' };

async function main() {
  // 健康检查
  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null);
  check('health ok', health?.ok === true);

  const ca = makeClient();
  const cb = makeClient();

  const isFirstUser = await firstUserWillBeAdmin();

  const ra = await ca('POST', '/api/auth/register', A);
  check('register A 200', ra.status === 200, `status=${ra.status}`);
  check('register A role', isFirstUser ? ra.json?.user?.role === 'admin' : !!ra.json?.user, `role=${ra.json?.user?.role}`);

  const rb = await cb('POST', '/api/auth/register', B);
  check('register B 200 role=user', rb.status === 200 && rb.json?.user?.role === 'user', `status=${rb.status} role=${rb.json?.user?.role}`);

  // 用一个全新客户端登录 A
  const ca2 = makeClient();
  const la = await ca2('POST', '/api/auth/login', A);
  check('login A 200', la.status === 200, `status=${la.status}`);

  const me = await ca2('GET', '/api/me');
  check('me returns A', me.json?.user?.username === A.username);

  // state LWW
  const t1 = Date.now();
  const put1 = await ca2('PUT', '/api/state/ic-packaging/progress', { data: { '4-1-1': 'mastered' }, updated_at: t1 });
  check('PUT progress applied', put1.json?.applied === true);

  const get1 = await ca2('GET', '/api/state/ic-packaging/progress');
  check('GET progress matches', get1.json?.data?.['4-1-1'] === 'mastered' && get1.json?.updated_at === t1);

  const simulationState = { 'sandbox:smoke': { version: 1, controls: [{ index: 0, value: '850', checked: null }], score: { score: 1, total: 1, detail: '' } } };
  const putSimulation = await ca2('PUT', '/api/state/ic-packaging/simulations', { data: simulationState, updated_at: t1 });
  check('PUT simulations applied', putSimulation.json?.applied === true);
  const getSimulation = await ca2('GET', '/api/state/ic-packaging/simulations');
  check('GET simulations matches', getSimulation.json?.data?.['sandbox:smoke']?.controls?.[0]?.value === '850');

  const putOld = await ca2('PUT', '/api/state/ic-packaging/progress', { data: { '4-1-1': 'read' }, updated_at: t1 - 5000 });
  check('LWW rejects older', putOld.json?.applied === false && putOld.json?.updated_at === t1);

  const putBad = await ca2('PUT', '/api/state/ic-packaging/nope', { data: {}, updated_at: Date.now() });
  check('unknown slot 400', putBad.status === 400);

  const sync = await ca2('GET', '/api/sync');
  const hasRow = Array.isArray(sync.json?.states) && sync.json.states.some((s) => s.course_id === 'ic-packaging' && s.slot === 'progress');
  check('sync includes row', hasRow);
  const hasSimulation = sync.json?.states?.some((s) => s.course_id === 'ic-packaging' && s.slot === 'simulations');
  check('sync includes simulations', hasSimulation);

  // admin 守卫
  const adminList = await ca2('GET', '/api/admin/users');
  const listOkForAdmin = isFirstUser ? (adminList.status === 200 && Array.isArray(adminList.json?.users)) : true;
  check('admin/users for A', listOkForAdmin, `status=${adminList.status}`);

  const cb2 = makeClient();
  await cb2('POST', '/api/auth/login', B);
  const adminListB = await cb2('GET', '/api/admin/users');
  check('admin/users 403 for B (user)', adminListB.status === 403, `status=${adminListB.status}`);

  // 改密码
  const pw = await ca2('POST', '/api/me/password', { oldPassword: A.password, newPassword: A.password + 'x' });
  check('change password 204', pw.status === 204, `status=${pw.status}`);

  // 登出
  const lo = await ca2('POST', '/api/auth/logout');
  check('logout 204', lo.status === 204);
  const meAfter = await ca2('GET', '/api/me');
  check('me 401 after logout', meAfter.status === 401, `status=${meAfter.status}`);

  // 断言密码不落明文
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const row = db.prepare('SELECT pass_hash FROM users WHERE username = ?').get(A.username);
    db.close();
    check('password hashed (bcrypt $2)', typeof row?.pass_hash === 'string' && row.pass_hash.startsWith('$2'));
    check('password not plaintext', !String(row?.pass_hash).includes(A.password));
  } catch (e) {
    check('read db for hash assertion', false, String(e));
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// 读库判断本次 register A 是否会成为首个用户(影响 admin 断言)。
async function firstUserWillBeAdmin() {
  try {
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    db.close();
    return n === 0;
  } catch {
    return false; // 库还不存在等情况:不强断言 admin
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
