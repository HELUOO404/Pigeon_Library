// sidebar-renderer.js — 目录树、章节 tab、侧栏/页脚学习进度的渲染与更新。
import { icon } from '../core/icons.js';
import { escapeHtml, getDoneCount, getKnowledgePointCountByChapter, getKnowledgePointIds, sectionDomId } from './utils.js';

export function renderTabs(container, manifest) {
  container.innerHTML = manifest.chapters.map((chapter, idx) =>
    `<button class="tab ${idx === 0 ? 'active' : ''}" data-action="switch-chapter" data-chapter="${escapeHtml(chapter.id)}">${escapeHtml(chapter.tabLabel || chapter.title)}</button>`,
  ).join('');
}

function sectionStatus(section, progress) {
  const ids = section.knowledgePoints.map((kp) => kp.id);
  const done = getDoneCount(progress, ids);
  return done === ids.length && ids.length ? 'mastered' : done ? 'read' : 'opened';
}

export function renderSidebar(container, manifest, store, activeChapter = manifest.chapters[0]?.id, activeSection = '') {
  const progress = store.get('progress', {});
  container.innerHTML = `
    <div class="sidebar-header">${icon('list-tree')} 目录导航</div>
    <div class="sidebar-progress">
      <div class="progress-title">学习进度</div>
      <div class="progress-bar"><div class="progress-fill" id="totalProgressFill" style="width:0%"></div></div>
      <div class="progress-text" id="totalProgressText">总进度 0%</div>
    </div>
    ${manifest.chapters.map((chapter) => {
      const current = chapter.id === activeChapter;
      const chapterBodyId = `tree-chapter-${chapter.id}`;
      return `
      <section class="tree-chapter${current ? ' is-current is-expanded' : ''}" data-ch="${escapeHtml(chapter.id)}">
        <button type="button" class="tree-title" data-action="switch-sidebar-chapter" data-chapter="${escapeHtml(chapter.id)}" aria-expanded="${current}" aria-controls="${escapeHtml(chapterBodyId)}"><span class="arrow">▾</span><span>${escapeHtml(chapter.title)}</span></button>
        <div class="tree-chapter-body" id="${escapeHtml(chapterBodyId)}" aria-hidden="${!current}">
          <div class="tree-chapter-content">
            ${chapter.sections.map((section) => `
              <section class="tree-subsection" aria-labelledby="tree-section-${sectionDomId(section.id)}">
                <button type="button" id="tree-section-${sectionDomId(section.id)}" class="tree-section-label ${sectionStatus(section, progress)}${section.id === activeSection ? ' active' : ''}" data-action="navigate" data-section="${escapeHtml(section.id)}"${section.id === activeSection ? ' aria-current="location"' : ''}><span class="status-dot ${sectionStatus(section, progress)}" id="status-${sectionDomId(section.id)}"></span><span>${escapeHtml(section.title)}</span></button>
                <div class="tree-knowledge-list">
                  ${section.knowledgePoints.map((kp) => {
                    const status = progress[kp.id] || 'opened';
                    return `<button type="button" class="tree-item" data-action="navigate" data-section="${escapeHtml(section.id)}" data-card="kp-${escapeHtml(kp.id)}"><span class="status-dot ${escapeHtml(status)}" id="dot-${escapeHtml(kp.id)}"></span><span>${escapeHtml(kp.title)}</span></button>`;
                  }).join('')}
                </div>
              </section>
            `).join('')}
          </div>
        </div>
      </section>`;
    }).join('')}
  `;
}

export function setSidebarChapter(chapterId) {
  document.querySelectorAll('.tree-chapter').forEach((chapter) => {
    const current = chapter.dataset.ch === chapterId;
    chapter.classList.toggle('is-current', current);
    chapter.classList.toggle('is-expanded', current);
    chapter.querySelector('.tree-title')?.setAttribute('aria-expanded', String(current));
    chapter.querySelector('.tree-chapter-body')?.setAttribute('aria-hidden', String(!current));
  });
}

export function toggleSidebarChapter(chapterId) {
  const chapter = [...document.querySelectorAll('.tree-chapter')].find((item) => item.dataset.ch === chapterId);
  if (!chapter) return;
  const body = chapter.querySelector('.tree-chapter-body');
  const title = chapter.querySelector('.tree-title');
  const expanded = !chapter.classList.contains('is-expanded');
  chapter.classList.toggle('is-expanded', expanded);
  body?.setAttribute('aria-hidden', String(!expanded));
  title?.setAttribute('aria-expanded', String(expanded));
}

export function setSidebarSection(sectionId) {
  document.querySelectorAll('.tree-section-label').forEach((label) => {
    const active = label.dataset.section === sectionId;
    label.classList.toggle('active', active);
    if (active) label.setAttribute('aria-current', 'location');
    else label.removeAttribute('aria-current');
  });
}

export function getReadingSectionId(sections, main, chapterId) {
  if (!main) return '';
  const chapterSections = sections.filter((section) => section.chapterId === chapterId);
  if (!chapterSections.length) return '';
  if (main.scrollTop + main.clientHeight >= main.scrollHeight - 2) return chapterSections.at(-1).id;

  const readingLine = main.getBoundingClientRect().top + Math.min(160, main.clientHeight * 0.2);
  let active = chapterSections[0];
  for (const section of chapterSections) {
    const anchor = document.getElementById(`overview-${sectionDomId(section.id)}`)
      || document.getElementById(`kp-${section.knowledgePoints[0]?.id}`);
    if (!anchor) continue;
    if (anchor.getBoundingClientRect().top > readingLine) break;
    active = section;
  }
  return active.id;
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
      const status = sectionDone === sectionIds.length && sectionIds.length ? 'mastered' : sectionDone ? 'read' : 'opened';
      const dot = document.getElementById(`status-${sectionDomId(section.id)}`);
      if (dot) {
        dot.className = `status-dot ${status}`;
      }
      const label = document.getElementById(`tree-section-${sectionDomId(section.id)}`);
      if (label) {
        label.classList.remove('opened', 'read', 'mastered');
        label.classList.add(status);
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

