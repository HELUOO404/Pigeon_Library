// theme.js — 亮/暗主题切换,站点级(首页与学习页共享)。
// 复刻原站 toggleTheme(index.html:1244)的行为,key 改为 pglib 命名空间下的全局键。

import { globalGet, globalSet } from './store.js';

const THEME_KEY = 'theme';

/** 在页面尽早调用(<head> 内联或入口首行),避免首屏主题闪烁。 */
export function applyInitialTheme() {
  const t = globalGet(THEME_KEY, 'light');
  document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
}

export function toggleTheme() {
  const d = document.documentElement;
  const t = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  d.setAttribute('data-theme', t);
  globalSet(THEME_KEY, t);
  return t;
}

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
