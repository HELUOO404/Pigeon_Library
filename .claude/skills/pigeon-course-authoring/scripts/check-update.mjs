#!/usr/bin/env node
// check-update.mjs — 轻量检查本 Skill 是否有新版(按需运行,不每次强制联网)。
// 拉取 GitHub 上的 VERSION 与本地 VERSION 比对;有新版给出提示。离线/失败均静默放行(退出 0)。
//
// 用法:node check-update.mjs
// 退出码:0 = 已是最新 / 无法检查(不阻断);3 = 检测到新版(仅作信号,非错误)。
//
// 实现注:用 process.exitCode + 自然退出(不调 process.exit()),并先读完响应体,
//        以规避 Windows 上 undici 套接字关闭与强制退出竞争导致的 libuv 断言崩溃。

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_VERSION_PATH = path.join(HERE, '..', 'VERSION');
const RAW_URL = 'https://raw.githubusercontent.com/HELUOO404/Pigeon_Library/main/.claude/skills/pigeon-course-authoring/VERSION';

// "2.1.0" → [2,1,0];比较返回 1 / 0 / -1
function parseVer(s) { return String(s || '').trim().split('.').map((x) => Number(x) || 0); }
function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function main() {
  if (!existsSync(LOCAL_VERSION_PATH)) { console.log('本地无 VERSION 文件,跳过检查。'); return; }
  const local = readFileSync(LOCAL_VERSION_PATH, 'utf8').trim();

  let remote;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let text;
    try {
      const res = await fetch(RAW_URL, { signal: ctrl.signal });
      text = await res.text();            // 始终读完响应体,释放套接字
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } finally {
      clearTimeout(timer);
    }
    remote = text.trim();
  } catch (e) {
    console.log(`无法检查更新(离线或网络受限:${e.message})。当前本地版本 ${local}。`);
    return;
  }

  const c = cmpVer(remote, local);
  if (c > 0) {
    console.log(`发现新版:本地 ${local} → 远端 ${remote}。`);
    console.log('更新:重新拉取 .claude/skills/pigeon-course-authoring/ 目录覆盖本地即可。');
    process.exitCode = 3;
    return;
  }
  console.log(`已是最新(本地 ${local}${c < 0 ? `,领先远端 ${remote}` : ''})。`);
}

main();
