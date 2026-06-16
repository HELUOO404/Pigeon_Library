// main-home.js — 首页脚本:课程卡渲染、.pigeon 上传解析与本地保存、格式说明手风琴、图标水合。
import { BUILTIN_COURSES, deleteLocalCourse, listLocalCourses, saveLocalCourse } from './core/course-registry.js';
import { loadPigeonFromFile, loadPigeonFromUrl, pigeonErrorText } from './core/pigeon-loader.js';
import { createStore } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';

applyInitialTheme();

const AI_PROMPT_FALLBACK = '请把我提供的教材整理成 PigeonLib schemaVersion 1 的 .pigeon 课程包源码(manifest.json / content.json / quiz.json / glossary.json + assets/images)。完整制作规范见首页"格式说明"区或 docs/ai-course-authoring-prompt.md。';

async function loadAuthoringPrompt() {
  try {
    const res = await fetch('/docs/ai-course-authoring-prompt.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const text = (await res.text()).trim();
    return text || AI_PROMPT_FALLBACK;
  } catch {
    return AI_PROMPT_FALLBACK;
  }
}

const state = {
  localCourses: [],
  builtinCourses: BUILTIN_COURSES.map((course) => ({ ...course, meta: course })),
  builtinError: false,
};

const el = {
  nav: document.getElementById('siteNav'),
  builtinCount: document.getElementById('builtinCount'),
  localCount: document.getElementById('localCount'),
  builtinGrid: document.getElementById('builtinGrid'),
  localGrid: document.getElementById('localGrid'),
  dropzone: document.getElementById('dropzone'),
  file: document.getElementById('courseFile'),
  dropTitle: document.getElementById('dropTitle'),
  aiPrompt: document.getElementById('aiPrompt'),
  copyStatus: document.getElementById('copyStatus'),
};

function text(value, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function getStats(meta = {}) {
  const stats = meta.stats || {};
  return {
    chapters: stats.chapters ?? countChapters(meta),
    knowledgePoints: stats.knowledgePoints ?? countKnowledgePoints(meta),
    questions: stats.questions ?? 0,
  };
}

function countChapters(meta) {
  return Array.isArray(meta.chapters) ? meta.chapters.length : 0;
}

function countKnowledgePoints(meta) {
  if (!Array.isArray(meta.chapters)) return 0;
  return meta.chapters.reduce((sum, chapter) => {
    const sections = Array.isArray(chapter.sections) ? chapter.sections : [];
    return sum + sections.reduce((inner, section) => inner + (section.knowledgePoints?.length || 0), 0);
  }, 0);
}

function getProgress(courseId, total) {
  const progress = createStore(courseId).get('progress', {});
  const values = Object.values(progress || {});
  if (!values.length || !total) return null;
  const mastered = values.filter((value) => value === 'mastered').length;
  return { mastered, total, pct: Math.round((mastered / total) * 100) };
}

function courseMeta(course) {
  return course.meta || course;
}

function renderCourseCard(course, kind) {
  const meta = courseMeta(course);
  const title = text(meta.title, course.id);
  const subtitle = text(meta.subtitle, kind === 'builtin' ? '平台官方课程' : '本地投递课程');
  const safeTitle = escapeHtml(title);
  const safeSubtitle = escapeHtml(subtitle);
  const stats = getStats(meta);
  const progress = getProgress(course.id, stats.knowledgePoints);
  const coverImg = meta.coverDataUrl || '';        // 封面图(base64),优先
  const coverText = text(meta.coverText);           // 无图时的自定义封面文字
  const card = document.createElement('article');
  card.className = `course-card ${kind === 'local' ? 'is-local' : 'is-builtin'}`;
  card.dataset.courseId = course.id;
  card.innerHTML = `
    <div class="course-cover" aria-hidden="true">${coverImg ? '' : `<span class="${coverText ? 'cover-text' : 'cover-letter'}">${escapeHtml(coverText || title.slice(0, 1))}</span>`}</div>
    <div class="course-topline">
      <span class="course-badge">${kind === 'builtin' ? '内置' : '本地'}</span>
      ${kind === 'local' ? `<button class="delete-course" type="button" data-action="delete-course" title="删除课程" aria-label="删除课程">${icon('trash-2', { size: 16 })}</button>` : ''}
    </div>
    <h3>${safeTitle}</h3>
    <p class="course-subtitle">${safeSubtitle}</p>
    <p class="course-stats"><span>${icon('book', { size: 13 })} ${stats.chapters} 章</span> <span>${icon('bookmark', { size: 13 })} ${stats.knowledgePoints} 知识点</span> <span>${icon('square-pen', { size: 13 })} ${stats.questions} 题</span></p>
    ${progress ? `<div class="course-progress" aria-label="学习进度 ${progress.pct}%"><span style="width:${progress.pct}%"></span></div><p class="progress-text">已掌握 ${progress.mastered}/${progress.total} · ${progress.pct}%</p>` : ''}
    <a class="study-link" href="/learn.html?course=${encodeURIComponent(course.id)}">开始学习 ▸</a>
  `;
  const cover = card.querySelector('.course-cover');
  if (coverImg) { cover.style.backgroundImage = `url("${coverImg}")`; cover.classList.add('has-image'); }
  return card;
}

function renderCourses(highlightId) {
  el.builtinGrid.replaceChildren(...state.builtinCourses.map((course, index) => {
    const card = renderCourseCard(course, 'builtin');
    card.style.animationDelay = `${index * 70}ms`;
    return card;
  }));

  if (state.localCourses.length) {
    el.localGrid.replaceChildren(...state.localCourses.map((course, index) => {
      const card = renderCourseCard(course, 'local');
      card.style.animationDelay = `${index * 70}ms`;
      if (course.id === highlightId) card.classList.add('just-added');
      return card;
    }));
  } else {
    const empty = document.createElement('div');
    empty.className = 'empty-card';
    empty.textContent = '暂无上传课程。投递一个 .pigeon 后会出现在这里。';
    el.localGrid.replaceChildren(empty);
  }

  el.builtinCount.textContent = String(BUILTIN_COURSES.length);
  el.localCount.textContent = String(state.localCourses.length);
  renderBuiltinNotice();
}

function renderBuiltinNotice() {
  const grid = el.builtinGrid;
  let notice = document.getElementById('builtinNotice');
  if (state.builtinError) {
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'builtinNotice';
      notice.style.cssText = 'margin:0 0 16px;padding:12px 16px;border-radius:10px;background:rgba(200,150,42,.12);color:var(--ink,#1b2330);font-size:14px;line-height:1.6;';
      grid.parentElement.insertBefore(notice, grid);
    }
    notice.textContent = '内置课程未能加载,可能尚未打包。请双击「启动PigeonLib.bat」启动,或在仓库根运行:node tools/build-pigeon.mjs ic-packaging';
  } else if (notice) {
    notice.remove();
  }
}

async function hydrateBuiltinStats() {
  let failed = false;
  const courses = await Promise.all(BUILTIN_COURSES.map(async (course) => {
    try {
      const loaded = await loadPigeonFromUrl(`/${course.url}`);
      const meta = { ...course, ...loaded.manifest, coverDataUrl: loaded.coverDataUrl || '' };
      loaded.revoke();
      return { ...course, meta };
    } catch {
      failed = true;
      return { ...course, meta: course };
    }
  }));
  state.builtinCourses = courses;
  state.builtinError = failed;
}

async function refreshLocalCourses(highlightId) {
  state.localCourses = await listLocalCourses();
  renderCourses(highlightId);
}

function setDropState(status, title, detail) {
  el.dropzone.dataset.status = status;
  el.dropTitle.textContent = title;
  const help = document.getElementById('uploadHelp');
  if (help) help.textContent = detail;
}

async function handleUpload(file) {
  if (!file) return;
  setDropState('parsing', '正在拆封课程包', '解压 → 校验 manifest → 读题库 → 保存到本机');
  try {
    const [course, rawBuffer] = await Promise.all([loadPigeonFromFile(file), file.arrayBuffer()]);
    const bytes = new Uint8Array(rawBuffer);
    const meta = {
      title: course.manifest.title,
      subtitle: course.manifest.subtitle || '',
      author: course.manifest.author || '',
      version: course.manifest.version || '',
      stats: getStats(course.manifest),
      coverDataUrl: course.coverDataUrl || '',
      coverText: course.manifest.coverText || '',
    };
    await saveLocalCourse({ id: course.id, bytes, meta });
    course.revoke();
    await refreshLocalCourses(course.id);
    setDropState('success', `导入成功:《${meta.title}》`, '课程已进入“我的课程”,可以立即开始学习');
    setTimeout(() => setDropState('idle', '拖拽 .pigeon 到这里', '或点击选择文件 · 单文件 ≤50MB · 全程本地解析'), 2000);
  } catch (error) {
    setDropState('error', `无法导入:${pigeonErrorText(error)}`, '请检查课程包结构,或查看下方 .pigeon 格式说明');
    document.getElementById('format')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    el.file.value = '';
  }
}

async function deleteCourse(id) {
  if (!confirm('确定删除这门本地课程吗？学习进度不会自动清除。')) return;
  await deleteLocalCourse(id);
  await refreshLocalCourses();
}

function togglePanel(trigger, forceOpen = false) {
  const panel = trigger.closest('.format-panel');
  const isOpen = forceOpen || !panel.classList.contains('open');
  document.querySelectorAll('.format-panel.open').forEach((item) => {
    if (item !== panel) {
      item.classList.remove('open');
      item.querySelector('.panel-trigger span').textContent = '展开 ▾';
    }
  });
  panel.classList.toggle('open', isOpen);
  trigger.querySelector('span').textContent = isOpen ? '收起 ▴' : '展开 ▾';
}

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const actionTarget = event.target.closest('[data-action]');
    const panelTrigger = event.target.closest('.panel-trigger');
    if (panelTrigger) togglePanel(panelTrigger);
    if (!actionTarget) return;

    const action = actionTarget.dataset.action;
    if (action === 'toggle-menu') el.nav.classList.toggle('open');
    else if (action === 'toggle-theme') toggleTheme();
    else if (action === 'choose-file') el.file.click();
    else if (action === 'delete-course') {
      event.preventDefault();
      const id = actionTarget.closest('.course-card')?.dataset.courseId;
      if (id) await deleteCourse(id);
    } else if (action === 'open-format') {
      const first = document.querySelector('.format-panel .panel-trigger');
      if (first) togglePanel(first, true);
    } else if (action === 'copy-prompt') {
      await navigator.clipboard.writeText(el.aiPrompt.value);
      el.copyStatus.textContent = '已复制';
      setTimeout(() => { el.copyStatus.textContent = ''; }, 1600);
    }
  });

  el.file.addEventListener('change', () => handleUpload(el.file.files?.[0]));
  el.dropzone.addEventListener('click', (event) => {
    if (!event.target.closest('button')) el.file.click();
  });
  el.dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      el.file.click();
    }
  });
  ['dragenter', 'dragover'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      setDropState('drag-over', '松手即可导入', '正在接收这枚知识投递包');
    });
  });
  ['dragleave', 'drop'].forEach((type) => {
    el.dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === 'drop') handleUpload(event.dataTransfer.files?.[0]);
      else setDropState('idle', '拖拽 .pigeon 到这里', '或点击选择文件 · 单文件 ≤50MB · 全程本地解析');
    });
  });
}

async function init() {
  hydrateIcons();                       // 填充顶栏/页脚等静态 chrome 的 SVG 图标
  el.aiPrompt.value = await loadAuthoringPrompt();
  bindEvents();
  renderCourses();
  await Promise.all([hydrateBuiltinStats(), refreshLocalCourses()]);
  renderCourses();
}

init().catch((error) => {
  console.error(error);
  state.builtinError = true;
  renderCourses();
});

