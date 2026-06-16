// panels.js — 浮层面板:学习仪表盘 / 错题本 / 术语速查。
import { icon } from '../core/icons.js';
import { escapeHtml, formatStudyTime, getDoneCount, getKnowledgePointIds } from './utils.js';
import { filterGlossary, renderGlossaryList } from './glossary.js';
import { filterWrong, getWrongQuestions, redoAllWrong, renderWrongList } from './wrongbook.js';

let context;

export function initPanels(ctx) {
  context = ctx;
}

export function openPanel(type) {
  const panel = document.getElementById('panel');
  if (!panel) return;
  let html = `<button class="panel-close" data-action="close-panel" aria-label="关闭">${icon('x', { size: 20 })}</button>`;
  if (type === 'wrongBook') {
    html += `<h3 style="margin-bottom:16px">${icon('circle-x')} 错题本</h3>`;
    html += '<div style="margin-bottom:12px;display:flex;gap:6px;flex-wrap:wrap;">';
    html += '<button class="btn-secondary" style="font-size:12px;padding:4px 10px;" data-action="filter-wrong" data-chapter="all">全部</button>';
    context.manifest.chapters.forEach((chapter) => {
      html += `<button class="btn-secondary" style="font-size:12px;padding:4px 10px;" data-action="filter-wrong" data-chapter="${escapeHtml(chapter.id)}">第${escapeHtml(chapter.id)}章</button>`;
    });
    html += '<button class="btn-primary" style="font-size:12px;padding:4px 10px;margin-left:auto;" data-action="redo-all-wrong">全部重做</button></div><div id="wrongList"></div>';
  } else if (type === 'glossary') {
    html += `<h3 style="margin-bottom:16px">${icon('book-open')} 术语速查</h3>`;
    html += '<input type="text" placeholder="搜索术语..." data-action="filter-glossary" style="width:100%;padding:8px;border:1px solid var(--cbd);border-radius:var(--r);margin-bottom:12px;font-size:14px">';
    html += '<div class="glossary-grid" id="glossaryList"></div>';
  } else if (type === 'dashboard') {
    const progress = context.store.get('progress', {});
    const ids = getKnowledgePointIds(context.manifest);
    const mastered = Object.values(progress).filter((v) => v === 'mastered').length;
    const readCount = Object.values(progress).filter((v) => v === 'read').length;
    const wrongCount = getWrongQuestions().length;
    const pct = ids.length ? Math.round((getDoneCount(progress, ids) / ids.length) * 100) : 0;
    html += `<h3 style="margin-bottom:16px">${icon('layout-dashboard')} 学习仪表盘</h3>`;
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">';
    html += `<div style="text-align:center;padding:16px;background:var(--chv);border-radius:var(--r)"><div style="font-size:24px;font-weight:700;color:var(--cs)">${mastered}</div><div style="font-size:12px;color:var(--ctx2)">已掌握</div></div>`;
    html += `<div style="text-align:center;padding:16px;background:var(--chv);border-radius:var(--r)"><div style="font-size:24px;font-weight:700;color:var(--ci)">${readCount}</div><div style="font-size:12px;color:var(--ctx2)">已阅读</div></div>`;
    html += `<div style="text-align:center;padding:16px;background:var(--chv);border-radius:var(--r)"><div style="font-size:24px;font-weight:700;color:var(--cd)">${wrongCount}</div><div style="font-size:12px;color:var(--ctx2)">错题</div></div>`;
    html += `<div style="text-align:center;padding:16px;background:var(--chv);border-radius:var(--r)"><div style="font-size:24px;font-weight:700;color:var(--c1)">${pct}%</div><div style="font-size:12px;color:var(--ctx2)">总进度</div></div></div>`;
    html += `<div style="margin-top:12px"><strong>学习进度</strong><div style="background:var(--cbd);border-radius:4px;height:8px;margin-top:8px"><div style="background:var(--cs);height:8px;border-radius:4px;width:${pct}%"></div></div><p style="font-size:12px;color:var(--ctx2);margin-top:4px">${getDoneCount(progress, ids)}/${ids.length} 知识点 (${pct}%)</p></div>`;
    html += `<div style="margin-top:12px"><strong>学习时长</strong><p style="font-size:14px;color:var(--c1);margin-top:4px">${formatStudyTime(context.getStudyTime())}</p></div>`;
    html += `<button data-action="reset-progress" style="margin-top:16px;padding:8px 16px;background:var(--danger);color:#fff;border:none;border-radius:var(--r);cursor:pointer;font-size:13px">${icon('rotate-ccw')} 重置学习进度</button>`;
  }
  panel.innerHTML = html;
  panel.classList.add('open');
  document.getElementById('panelOverlay')?.classList.add('show');
  if (type === 'wrongBook') renderWrongList();
  if (type === 'glossary') renderGlossaryList();
}

export function closePanel() {
  document.getElementById('panelOverlay')?.classList.remove('show');
  document.getElementById('panel')?.classList.remove('open');
}

export function handlePanelAction(target) {
  const action = target.dataset.action;
  if (action === 'filter-wrong') filterWrong(target.dataset.chapter);
  if (action === 'redo-all-wrong') redoAllWrong();
  if (action === 'filter-glossary') filterGlossary(target.value);
}

