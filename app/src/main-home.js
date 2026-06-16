import { BUILTIN_COURSES, deleteLocalCourse, listLocalCourses, saveLocalCourse } from './core/course-registry.js';
import { loadPigeonFromFile, loadPigeonFromUrl, pigeonErrorText } from './core/pigeon-loader.js';
import { createStore } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';

applyInitialTheme();

const AI_PROMPT = `请把我提供的教材整理成 PigeonLib schemaVersion 1 的 .pigeon 课程包源码。必须产出 manifest.json、content.json、quiz.json、glossary.json,以及必要的 assets/images。id 使用小写英文、数字和连字符;章节 id 用 "4",小节 id 用 "4.1",知识点 id 用 "4-1-1"。

content.json 按知识点切分正文,使用 paragraph、heading、image、paramsTable、summaryBox、compareBox、sectionQuiz 等类型化块。图片放入 assets/images,正文只写相对路径。

术语表 glossary.json 从教材自动抽取缩写和专有名词,生成 {t,full,cn,d};t 必须使用正文中的实际写法,包括 T/C 这类符号,保证悬浮提示能命中;d 用一句话解释,不要写长段。

题库 quiz.json 如原资料只有题目没有解析,请为每题补充 exp 或 explain:说明为什么正确、其他选项为什么错、关联哪个知识点、记忆要点。single 侧重选项辨析,judge 说明判断依据,sort 说明步骤顺序,match 说明配对关系。解析必须基于课程正文,不确定处标注“需人工复核”,不要杜撰。

最后检查 JSON 可解析、manifest.chapters 能索引所有知识点、题目答案存在且格式一致、图片路径存在。`;

const state = {
  localCourses: [],
  builtinCourses: BUILTIN_COURSES.map((course) => ({ ...course, meta: course })),
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
  const card = document.createElement('article');
  card.className = `course-card ${kind === 'local' ? 'is-local' : 'is-builtin'}`;
  card.dataset.courseId = course.id;
  card.innerHTML = `
    <div class="course-cover" aria-hidden="true">${meta.cover ? '' : `<span>${escapeHtml(title.slice(0, 1))}</span>`}</div>
    <div class="course-topline">
      <span class="course-badge">${kind === 'builtin' ? '内置' : '本地'}</span>
      ${kind === 'local' ? '<button class="delete-course" type="button" data-action="delete-course" title="删除课程" aria-label="删除课程">🗑</button>' : ''}
    </div>
    <h3>${safeTitle}</h3>
    <p class="course-subtitle">${safeSubtitle}</p>
    <p class="course-stats">📑 ${stats.chapters} 章 <span>🔖 ${stats.knowledgePoints} 知识点</span> <span>📝 ${stats.questions} 题</span></p>
    ${progress ? `<div class="course-progress" aria-label="学习进度 ${progress.pct}%"><span style="width:${progress.pct}%"></span></div><p class="progress-text">已掌握 ${progress.mastered}/${progress.total} · ${progress.pct}%</p>` : ''}
    <a class="study-link" href="/learn.html?course=${encodeURIComponent(course.id)}">开始学习 ▸</a>
  `;
  const cover = card.querySelector('.course-cover');
  if (meta.cover) cover.style.backgroundImage = `url("${meta.cover}")`;
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
}

async function hydrateBuiltinStats() {
  const courses = await Promise.all(BUILTIN_COURSES.map(async (course) => {
    try {
      const loaded = await loadPigeonFromUrl(`/${course.url}`);
      const meta = { ...course, ...loaded.manifest };
      loaded.revoke();
      return { ...course, meta };
    } catch {
      return { ...course, meta: course };
    }
  }));
  state.builtinCourses = courses;
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
  el.aiPrompt.value = AI_PROMPT;
  bindEvents();
  renderCourses();
  await Promise.all([hydrateBuiltinStats(), refreshLocalCourses()]);
  renderCourses();
}

init().catch((error) => {
  console.error(error);
  renderCourses();
});
