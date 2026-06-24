// utils.js — 渲染层公用工具:HTML 转义、Span 内联渲染、章节展开、知识点计数与学习时长格式化。
export function escapeHtml(value) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(value == null ? '' : String(value)));
  return div.innerHTML;
}

export function textFromSpans(spans = []) {
  return spans.map((span) => span.t || '').join('');
}

export function renderSpans(spans = []) {
  return spans.map((span) => {
    const text = escapeHtml(span.t || '');
    if (span.b) return `<strong>${text}</strong>`;
    if (span.sub) return `<span class="sub-title">${text}</span>`;
    return text;
  }).join('');
}

export function sectionDomId(sectionId) {
  return String(sectionId).replace('.', '-');
}

export function getSections(manifest) {
  return manifest.chapters.flatMap((chapter) =>
    chapter.sections.map((section) => ({ ...section, chapterId: chapter.id, chapterTitle: chapter.title })),
  );
}

export function getKnowledgePointIds(manifest) {
  return getSections(manifest).flatMap((section) =>
    section.knowledgePoints.map((kp) => kp.id),
  );
}

export function getKnowledgePointCountByChapter(manifest, chapterId) {
  const chapter = manifest.chapters.find((ch) => ch.id === chapterId);
  if (!chapter) return 0;
  return chapter.sections.reduce((sum, section) => sum + section.knowledgePoints.length, 0);
}

export function getDoneCount(progress, ids) {
  return ids.filter((id) => progress[id] === 'read' || progress[id] === 'mastered').length;
}

export function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function formatStudyTime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return `${hours}时${minutes % 60}分`;
}

export function getCleanText(element) {
  if (!element) return '';
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.term-tip,.term-tooltip,script,style').forEach((el) => el.remove());
  return clone.textContent.replace(/\s+/g, ' ').trim();
}

