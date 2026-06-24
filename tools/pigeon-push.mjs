// pigeon-push.mjs — 课程包推送 CLI(瘦客户端):登录 → 打包 → 建课/新版本 → 可选提交审核。
//
// 站点地址四层回退(开源仓库零真实地址入库):
//   1) 命令行 --server https://your-host    (最高优先)
//   2) 环境变量 PIGEON_SERVER=...
//   3) 本地配置 tools/.pigeon-cli.json       (login 后写入 server + cookie,已 .gitignore)
//   4) 交互提示(默认 http://localhost:8787),输完写入 (3)
//
// 用法:
//   node tools/pigeon-push.mjs login                 交互输入用户名/密码 → 存会话
//   node tools/pigeon-push.mjs push <courseId>       打包并推送(自动 find-or-create);随后询问是否提交审核
//   node tools/pigeon-push.mjs logout                清除本地会话
//   通用可选项:--server <url>
//
// 安全:本工具由使用者本机运行;Claude/agent 不代输真实账号密码(见 CLAUDE.md 不变量 6)。
// 需 Node 20+(原生 fetch / FormData / Blob)。

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CONFIG_PATH = path.join(HERE, '.pigeon-cli.json');
const DEFAULT_SERVER = 'http://localhost:8787';

// 课程广场预设分类(与 server/config.js 的 COURSE_CATEGORIES 对齐;发布选其一)。
const COURSE_CATEGORIES = ['电子/集成电路', '材料/工艺', '计算机/软件', '数理基础', '通用/综合', '其他'];

// ---- 小工具 ----
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--server') { flags.server = argv[i + 1]; i += 1; }
    else if (a.startsWith('--server=')) flags.server = a.slice('--server='.length);
    else positional.push(a);
  }
  return { command: positional[0], rest: positional.slice(1), flags };
}

async function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try { return JSON.parse(await readFile(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}

async function saveConfig(cfg) {
  await writeFile(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

function ask(query, hidden = false) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      process.stdout.write(query);
      rl._writeToOutput = () => {};                 // 屏蔽密码回显
      rl.question('', (ans) => { process.stdout.write('\n'); rl.close(); resolve(ans.trim()); });
    } else {
      rl.question(query, (ans) => { rl.close(); resolve(ans.trim()); });
    }
  });
}

function normServer(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

// 四层回退解析站点地址。needPrompt=true 时第 4 层交互询问并写回配置。
async function resolveServer(flags, cfg, { needPrompt } = {}) {
  let server = normServer(flags.server) || normServer(process.env.PIGEON_SERVER) || normServer(cfg.server);
  if (!server && needPrompt) {
    const input = await ask(`后端地址(默认 ${DEFAULT_SERVER}): `);
    server = normServer(input) || DEFAULT_SERVER;
    cfg.server = server;
    await saveConfig(cfg);
  }
  return server;
}

async function errorText(res) {
  try {
    const body = await res.json();
    return body?.error?.message || body?.error?.code || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status} ${res.statusText}`;
  }
}

function dieAuth() {
  console.error('未登录或会话已过期。请先运行:node tools/pigeon-push.mjs login');
  process.exit(1);
}

// ---- 命令:login ----
async function cmdLogin(flags) {
  const cfg = await loadConfig();
  const server = await resolveServer(flags, cfg, { needPrompt: true });
  const username = await ask('用户名: ');
  const password = await ask('密码: ', true);
  if (!username || !password) { console.error('用户名/密码不能为空'); process.exit(1); }

  let res;
  try {
    res = await fetch(`${server}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (e) {
    console.error(`连接后端失败(${server}):${e.message}`);
    process.exit(1);
  }
  if (!res.ok) { console.error(`登录失败:${await errorText(res)}`); process.exit(1); }

  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = (setCookies[0] || '').split(';')[0];
  if (!cookie) { console.error('登录成功但未收到会话 cookie,无法保存。'); process.exit(1); }

  const body = await res.json().catch(() => ({}));
  cfg.server = server;
  cfg.cookie = cookie;
  await saveConfig(cfg);
  console.log(`已登录为 ${body?.user?.username || username}(${server})。会话已存入 tools/.pigeon-cli.json`);
}

// ---- 命令:logout ----
async function cmdLogout() {
  const cfg = await loadConfig();
  delete cfg.cookie;
  await saveConfig(cfg);
  console.log('已清除本地会话。');
}

// ---- 命令:push ----
async function cmdPush(courseId, flags) {
  if (!courseId) { console.error('用法:node tools/pigeon-push.mjs push <courseId>'); process.exit(1); }
  const cfg = await loadConfig();
  const server = await resolveServer(flags, cfg, { needPrompt: true });
  if (!cfg.cookie) dieAuth();

  // 1) 打包(确保 dist-courses/<courseId>.pigeon 为最新)
  console.log(`打包 ${courseId} …`);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-pigeon.mjs'), courseId], { stdio: 'inherit' });
  if (built.status !== 0) { console.error('打包失败,已中止推送。'); process.exit(1); }

  const pigeonPath = path.join(ROOT, 'dist-courses', `${courseId}.pigeon`);
  if (!existsSync(pigeonPath)) { console.error(`找不到打包产物:${pigeonPath}`); process.exit(1); }
  const bytes = await readFile(pigeonPath);

  // 2) find-or-create:按 course_key 匹配自己的课程(约定 courseId === manifest.id === course_key)
  const mineRes = await fetch(`${server}/api/courses/mine`, { headers: { Cookie: cfg.cookie } });
  if (mineRes.status === 401) dieAuth();
  if (!mineRes.ok) { console.error(`读取「我的课程」失败:${await errorText(mineRes)}`); process.exit(1); }
  const mine = (await mineRes.json()).courses || [];
  const existing = mine.find((c) => c.course_key === courseId);

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), `${courseId}.pigeon`);

  let courseDbId;
  if (existing) {
    console.log(`已存在课程 #${existing.id}「${existing.title}」,上传新版本 …`);
    const res = await fetch(`${server}/api/courses/${existing.id}/versions`, {
      method: 'POST', headers: { Cookie: cfg.cookie }, body: form,
    });
    if (!res.ok) { console.error(`上传新版本失败:${await errorText(res)}`); process.exit(1); }
    courseDbId = existing.id;
    const v = (await res.json()).version;
    console.log(`新版本已上传(version=${v?.version ?? '?'},私有待发布)。`);
  } else {
    console.log('未找到同名课程,创建新课程 …');
    const res = await fetch(`${server}/api/courses`, {
      method: 'POST', headers: { Cookie: cfg.cookie }, body: form,
    });
    if (!res.ok) { console.error(`创建课程失败:${await errorText(res)}`); process.exit(1); }
    const course = (await res.json()).course;
    courseDbId = course?.id;
    console.log(`课程已创建(#${courseDbId}「${course?.title}」,私有待发布)。`);
  }

  // 3) 可选:提交审核(需选分类)
  const yes = (await ask('是否提交审核?(y/N): ')).toLowerCase();
  if (yes !== 'y' && yes !== 'yes') {
    console.log('完成。课程保持私有,可稍后在网站「我的课程」提交审核。');
    return;
  }
  console.log('选择课程分类:');
  COURSE_CATEGORIES.forEach((c, i) => console.log(`  ${i + 1}) ${c}`));
  const pick = Number(await ask(`输入序号(1-${COURSE_CATEGORIES.length}): `));
  const category = COURSE_CATEGORIES[pick - 1];
  if (!category) { console.error('分类序号无效,已跳过提交审核。'); process.exit(1); }

  const pubRes = await fetch(`${server}/api/courses/${courseDbId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cfg.cookie },
    body: JSON.stringify({ category }),
  });
  if (!pubRes.ok) { console.error(`提交审核失败:${await errorText(pubRes)}`); process.exit(1); }
  console.log(`已提交审核(分类:${category})。等待管理员在审核队列处理。`);
}

// ---- 入口 ----
async function main() {
  const { command, rest, flags } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'login': return cmdLogin(flags);
    case 'logout': return cmdLogout();
    case 'push': return cmdPush(rest[0], flags);
    default:
      console.log('用法:');
      console.log('  node tools/pigeon-push.mjs login');
      console.log('  node tools/pigeon-push.mjs push <courseId>');
      console.log('  node tools/pigeon-push.mjs logout');
      console.log('  可选:--server <url>(也可用环境变量 PIGEON_SERVER)');
      process.exit(command ? 1 : 0);
  }
}

main().catch((e) => { console.error(e?.message || e); process.exit(1); });
