// content-renderer.js — 知识点正文渲染:类型化块(段落/表格/小结/对比/小测/图片/html/sandbox)→ HTML;
//   知识点的"已阅读/已掌握"状态与徽章更新也在此。html 块的相对资源路径在此解析为 Blob URL;
//   sandbox 块装进隔离 iframe(允许 JS,与主站隔离)。
import { icon } from '../core/icons.js';
import { escapeHtml, getSections, renderSpans, sectionDomId } from './utils.js';

/**
 * html 块里的相对资源路径(assets/...)在运行时并不存在 —— 课程图片是解压后的 Blob URL。
 * 故把 html 块内 <img src="assets/..."> 一类相对 src 解析成 course.resolveAsset 的 Blob URL,
 * 与 image 块行为一致;已是 http/blob/data/绝对路径的 src 原样保留。
 * 这让 html 块可承载复杂表格(含图、合并单元格)等结构化块表达不了的内容。
 */
function resolveHtmlAssets(html, course) {
  if (!html || !course?.resolveAsset) return html || '';
  return html.replace(/\bsrc="([^"]*)"/g, (whole, src) => {
    if (!src || /^(https?:|blob:|data:|\/)/i.test(src)) return whole;
    return `src="${escapeHtml(course.resolveAsset(src))}"`;
  });
}

/**
 * sandbox 块:把含 JS 逻辑的 HTML 片段装进隔离 iframe(sandbox="allow-scripts",不获 same-origin)。
 * 与主站完全隔离 —— 沙箱内读不到父页 DOM / localStorage / 登录 cookie / 学习进度,也改不了主站状态。
 * 代价是它不继承站点明暗主题与设计令牌(跨文档不可见),作者需在 html 内自管配色。
 * srcdoc 末尾注入高度上报脚本:load 与内容尺寸变化时 postMessage;学习页据 contentWindow 比对来源后调高度
 * (见 main-learn.js 的 message 监听)。escapeHtml 不转义引号,故 srcdoc 属性用 escapeAttr 转义。
 */
function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const SANDBOX_REPORTER =
  "(function(){function r(){try{parent.postMessage({pigeonHeight:document.documentElement.scrollHeight},'*')}catch(e){}}"
  + "addEventListener('load',r);r();if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement)}else{addEventListener('resize',r)}})()";

function renderSandbox(block, course) {
  const inner = resolveHtmlAssets(block.html || '', course);
  const height = Number(block.height) > 0 ? Math.floor(Number(block.height)) : 320;
  const srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<style>html,body{margin:0;padding:10px;font-family:system-ui,-apple-system,"Noto Sans SC",sans-serif;line-height:1.6}*{box-sizing:border-box}</style>'
    + `<body>${inner}<script>${SANDBOX_REPORTER}<\/script>`;
  return `<iframe class="sandbox-frame" sandbox="allow-scripts" loading="lazy" style="height:${height}px" srcdoc="${escapeAttr(srcdoc)}"></iframe>`;
}

function renderTable(block) {
  return `<div class="table-scroll"><table class="params-table"><thead><tr>${(block.headers || []).map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${(block.rows || []).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderSummary(block) {
  return `<div class="summary-box"><h4>${escapeHtml(block.title || '')}</h4><ul>${(block.items || []).map((item) => `<li>${renderSpans(item)}</li>`).join('')}</ul></div>`;
}

function renderCompare(block) {
  const headers = block.headers || [];
  const rows = block.rows || [];
  return `<div class="compare-box"><h4>${escapeHtml(block.title || '')}</h4><div class="table-scroll"><table class="compare-table"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr><td class="compare-label">${escapeHtml(row.label || '')}</td>${(row.cells || []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}

function renderQuizBlock(block, quiz) {
  const questions = quiz.sectionQuizzes?.[block.quizRef] || [];
  if (!questions.length) return '';
  return `<div class="section-quiz"><h4>${icon('square-pen')} 小测试</h4>${questions.map((q, idx) => `
    <div class="quiz-item" data-qid="${escapeHtml(q.qid)}">
      <p class="quiz-q">${idx + 1}. ${escapeHtml(q.q)}</p>
      <div class="quiz-opts">${(q.options || []).map((opt) => {
        const value = opt.charAt(0);
        return `<label class="quiz-opt" data-action="select-quiz" data-qid="${escapeHtml(q.qid)}"><input type="radio" name="${escapeHtml(q.qid)}" value="${escapeHtml(value)}"><span>${escapeHtml(opt)}</span></label>`;
      }).join('')}</div>
      <button class="quiz-submit-btn" data-action="submit-quiz" data-qid="${escapeHtml(q.qid)}">提交</button>
      <div class="quiz-fb" id="fb-${escapeHtml(q.qid)}"></div>
    </div>
  `).join('')}</div>`;
}

function renderBlock(block, course) {
  switch (block.type) {
    case 'paragraph':
      return `<p>${renderSpans(block.spans || [])}</p>`;
    case 'numTitle':
      return `<p><strong class="num-title">${escapeHtml(block.text || '')}</strong></p>`;
    case 'boldCaption':
      return `<p><strong>${escapeHtml(block.text || '')}</strong></p>`;
    case 'heading':
      return `<h4>${escapeHtml(block.text || '')}</h4>`;
    case 'image': {
      const src = course.resolveAsset(block.src);
      return `<img loading="lazy" onerror="this.style.display='none'" src="${escapeHtml(src)}" alt="${escapeHtml(block.alt || '')}" style="max-width:100%;margin:8px auto;display:block">`;
    }
    case 'paramsTable':
      return renderTable(block);
    case 'summaryBox':
      return renderSummary(block);
    case 'compareBox':
      return renderCompare(block);
    case 'sectionQuiz':
      return renderQuizBlock(block, course.quiz);
    case 'html':
      return resolveHtmlAssets(block.html || '', course);
    case 'sandbox':
      return renderSandbox(block, course);
    default:
      console.warn('Unknown content block type:', block.type);
      return '';
  }
}

function renderBlocks(blocks, course) {
  return (blocks || []).map((block) => renderBlock(block, course)).join('');
}

function renderOverview(section, course) {
  const overview = course.content.overviews?.[section.id];
  if (!overview) return '';
  return `<div class="overview-card" id="overview-${sectionDomId(section.id)}"><h2>${escapeHtml(overview.title || section.title)}</h2>${renderBlocks(overview.blocks, course)}</div>`;
}

function renderKnowledgePoint(kp, course, progress) {
  const content = course.content.knowledgePoints[kp.id];
  if (!content) return '';
  const status = progress[kp.id] || 'opened';
  const label = status === 'mastered' ? '已掌握' : status === 'read' ? '已阅读' : '未开始';
  const mastered = status === 'mastered';
  return `<div class="knowledge-card" id="kp-${escapeHtml(kp.id)}">
    <div class="card-header collapsed" data-action="toggle-card" data-kp-id="${escapeHtml(kp.id)}">
      <span class="card-toggle">▶</span>
      <h3 class="card-title">${escapeHtml(content.title || kp.title)}</h3>
      <span class="mastery-badge ${escapeHtml(status)}" id="badge-${escapeHtml(kp.id)}">${label}</span>
    </div>
    <div class="card-body hidden">
      ${renderBlocks(content.blocks, course)}
      <button class="mastery-btn" data-action="mark-mastered" data-kp-id="${escapeHtml(kp.id)}" ${mastered ? 'style="background:var(--cs);color:#fff;border-color:var(--cs)"' : ''}>${icon('check')} ${mastered ? '已掌握（点击取消）' : '标记为已掌握'}</button>
    </div>
  </div>`;
}

export function renderCourseContent(root, course, store) {
  const progress = store.get('progress', {});
  const html = course.manifest.chapters.map((chapter, idx) => `
    <div class="chapter-content" id="ch-${escapeHtml(chapter.id)}" style="display:${idx === 0 ? 'block' : 'none'}">
      ${chapter.sections.map((section) => `
        ${renderOverview(section, course)}
        ${section.knowledgePoints.map((kp) => renderKnowledgePoint(kp, course, progress)).join('')}
      `).join('')}
    </div>
  `).join('');
  root.insertAdjacentHTML('beforeend', html);
}

export function updateBadge(kpId, status) {
  const badge = document.getElementById(`badge-${kpId}`);
  if (badge) {
    badge.className = `mastery-badge ${status}`;
    badge.textContent = status === 'mastered' ? '已掌握' : status === 'read' ? '已阅读' : '未开始';
  }
  const dot = document.getElementById(`dot-${kpId}`);
  if (dot) dot.className = `status-dot ${status}`;
}

export function markRead(kpId, store, onChange) {
  const progress = store.get('progress', {});
  if (progress[kpId] !== 'mastered') {
    progress[kpId] = 'read';
    store.set('progress', progress);
    updateBadge(kpId, 'read');
    onChange?.();
  }
}

export function markMastered(kpId, button, store, onChange) {
  const progress = store.get('progress', {});
  const mastered = progress[kpId] === 'mastered';
  progress[kpId] = mastered ? 'read' : 'mastered';
  store.set('progress', progress);
  if (button) {
    // 文案为静态内容,可安全用 innerHTML 嵌入图标
    button.innerHTML = `${icon('check')} ${mastered ? '标记为已掌握' : '已掌握（点击取消）'}`;
    button.style.background = mastered ? '' : 'var(--cs)';
    button.style.color = mastered ? '' : '#fff';
    button.style.borderColor = mastered ? '' : 'var(--cs)';
  }
  updateBadge(kpId, progress[kpId]);
  onChange?.();
}

export function getAllSections(manifest) {
  return getSections(manifest);
}

