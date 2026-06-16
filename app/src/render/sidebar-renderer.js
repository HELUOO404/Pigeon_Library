// sidebar-renderer.js — 目录树、章节 tab、侧栏/页脚学习进度的渲染与更新。
import { icon } from '../core/icons.js';
import { escapeHtml, getDoneCount, getKnowledgePointCountByChapter, getKnowledgePointIds, sectionDomId } from './utils.js';

export function renderTabs(container, manifest) {
  container.innerHTML = manifest.chapters.map((chapter, idx) =>
    `<button class="tab ${idx === 0 ? 'active' : ''}" data-action="switch-chapter" data-chapter="${escapeHtml(chapter.id)}">${escapeHtml(chapter.tabLabel || chapter.title)}</button>`,
  ).join('');
}

export function renderSidebar(container, manifest, store) {
  const progress = store.get('progress', {});
  container.innerHTML = `
    <div class="sidebar-header">${icon('list-tree')} 目录导航</div>
    <div class="sidebar-progress">
      <div class="progress-title">学习进度</div>
      <div class="progress-bar"><div class="progress-fill" id="totalProgressFill" style="width:0%"></div></div>
      <div class="progress-text" id="totalProgressText">总进度 0%</div>
    </div>
    ${manifest.chapters.map((chapter) => `
      <div class="tree-section" data-ch="${escapeHtml(chapter.id)}">
        <div class="tree-title" data-action="toggle-tree"><span class="arrow">▼</span>${escapeHtml(chapter.title)}</div>
        ${chapter.sections.map((section) => `
          <div class="tree-items">
            <div class="tree-item" data-action="navigate" data-section="${escapeHtml(section.id)}" style="font-weight:600;color:var(--c1)"><span class="status-dot" id="status-${sectionDomId(section.id)}"></span>${escapeHtml(section.title)}</div>
            ${section.knowledgePoints.map((kp) => {
              const status = progress[kp.id] || 'opened';
              return `<div class="tree-item" data-action="navigate" data-section="${escapeHtml(section.id)}" data-card="kp-${escapeHtml(kp.id)}"><span class="status-dot ${escapeHtml(status)}" id="dot-${escapeHtml(kp.id)}"></span>${escapeHtml(kp.title)}</div>`;
            }).join('')}
          </div>
        `).join('')}
      </div>
    `).join('')}
  `;
}

export function updateSidebarProgress(manifest, store) {
  const ids = getKnowledgePointIds(manifest);
  const progress = store.get('progress', {});
  const done = getDoneCount(progress, ids);
  const pct = ids.length ? Math.round((done / ids.length) * 100) : 0;
  const fill = document.getElementById('totalProgressFill');
  const text = document.getElementById('totalProgressText');
  if (fill) fill.style.width = `${pct}%`;
  if (text) text.textContent = `总进度 ${pct}% · ${done}/${ids.length}`;

  manifest.chapters.forEach((chapter) => {
    chapter.sections.forEach((section) => {
      const sectionIds = section.knowledgePoints.map((kp) => kp.id);
      const sectionDone = getDoneCount(progress, sectionIds);
      const dot = document.getElementById(`status-${sectionDomId(section.id)}`);
      if (dot) {
        dot.className = `status-dot ${sectionDone === sectionIds.length && sectionIds.length ? 'mastered' : sectionDone ? 'read' : 'opened'}`;
      }
    });
  });
}

export function updateFooterProgress(manifest, store, currentChapter) {
  const chapter = manifest.chapters.find((ch) => ch.id === currentChapter);
  if (!chapter) return;
  const ids = chapter.sections.flatMap((section) => section.knowledgePoints.map((kp) => kp.id));
  const total = getKnowledgePointCountByChapter(manifest, currentChapter);
  const done = getDoneCount(store.get('progress', {}), ids);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const footer = document.getElementById('footerProgress');
  if (footer) footer.textContent = `第${currentChapter}章 ${pct}%`;
}

