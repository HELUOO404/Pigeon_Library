import { escapeHtml } from './utils.js';

let glossary = [];
let compiled = null;

export function initGlossary(items) {
  glossary = Array.isArray(items) ? items : [];
  compiled = glossary
    .filter((item) => item.t)
    .sort((a, b) => b.t.length - a.t.length)
    .map((item) => {
      const escaped = item.t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hasSlash = item.t.includes('/');
      const pattern = hasSlash
        ? `(^|[^\\w/])${escaped}(?![\\w])`
        : `(^|[^\\w/])\\b${escaped}\\b(?![\\w])`;
      return { item, re: new RegExp(pattern, 'g') };
    });
}

export function renderGlossaryList(filter = '') {
  const list = document.getElementById('glossaryList');
  if (!list) return;
  const q = filter.trim().toLowerCase();
  const items = q
    ? glossary.filter((g) => [g.t, g.full, g.cn, g.d].some((v) => String(v || '').toLowerCase().includes(q)))
    : glossary;
  list.innerHTML = items.map((g) => `
    <div class="glossary-card" data-action="term-nav" data-term="${escapeHtml(g.t)}">
      <div class="glossary-abbr">${escapeHtml(g.t)}</div>
      <div class="glossary-full">${escapeHtml(g.full || '')}</div>
      <div class="glossary-cn">${escapeHtml(g.cn || '')}</div>
      <div class="glossary-desc">${escapeHtml(g.d || '')}</div>
    </div>
  `).join('');
}

export function filterGlossary(value) {
  renderGlossaryList(value);
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent || parent.dataset.termsProcessedNode === '1') return true;
  return !!parent.closest('input,textarea,script,style,.term-tip,.term-tooltip');
}

export function processTermTips(root) {
  if (!compiled?.length || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  nodes.forEach((textNode) => {
    if (shouldSkipTextNode(textNode)) return;
    let text = textNode.textContent;
    let changed = false;
    compiled.forEach(({ item, re }) => {
      re.lastIndex = 0;
      if (re.test(text)) {
        changed = true;
        re.lastIndex = 0;
        text = text.replace(re, (match, prefix) => `${prefix}<span class="term-tip" data-abbr="${escapeHtml(item.t)}">${escapeHtml(item.t)}</span>`);
      }
    });
    if (!changed) return;
    const span = document.createElement('span');
    span.dataset.termsProcessedNode = '1';
    span.innerHTML = text;
    textNode.parentNode.replaceChild(span, textNode);
  });
}

export function initTermTips() {
  document.querySelectorAll('.card-body:not(.hidden):not([data-terms-processed])').forEach((body) => {
    processTermTips(body);
    body.dataset.termsProcessed = '1';
  });
}

export function bindTooltipEvents() {
  document.addEventListener('mouseover', (event) => {
    const tip = event.target.closest('.term-tip');
    if (!tip) return;
    const info = glossary.find((g) => g.t === tip.dataset.abbr);
    if (!info) return;
    let tooltip = tip.querySelector('.term-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('span');
      tooltip.className = 'term-tooltip';
      tooltip.innerHTML = `<div class="tt-abbr">${escapeHtml(info.t)}</div><div class="tt-full">${escapeHtml(info.full || '')}</div><div class="tt-cn">${escapeHtml(info.cn || '')}</div><div class="tt-desc">${escapeHtml(info.d || '')}</div>`;
      tip.appendChild(tooltip);
    }
    const rect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(280, vw - 20);
    const height = Math.min(180, vh - 20);
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.top - height - 4;
    if (left < 10) left = 10;
    if (left + width > vw - 10) left = vw - width - 10;
    if (top < 10) top = rect.bottom + 4;
    tooltip.style.maxWidth = `${width}px`;
    tooltip.style.maxHeight = `${height}px`;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  });
}

export function navigateToTerm(term) {
  const tip = Array.from(document.querySelectorAll('.term-tip')).find((el) => el.dataset.abbr === term);
  if (tip) {
    tip.scrollIntoView({ behavior: 'smooth', block: 'center' });
    tip.style.background = 'var(--chv)';
    setTimeout(() => { tip.style.background = ''; }, 1200);
  }
}

