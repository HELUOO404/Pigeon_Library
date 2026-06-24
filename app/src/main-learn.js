// main-learn.js — 学习页脚本:加载课程、串联各渲染器、绑定交互事件、图标水合、进度持久化。
import { findBuiltin, getLocalCourse } from './core/course-registry.js';
import { loadPigeonFromUrl, parsePigeon, pigeonErrorText } from './core/pigeon-loader.js';
import { downloadCourse } from './core/course-source.js';
import { createStore, globalSet } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';
import { initSession, api } from './core/session.js';
import { initSync } from './core/sync.js';
import { initAuthUI } from './core/auth-ui.js';
import { markMastered, markRead, renderCourseContent } from './render/content-renderer.js';
import { initExamEngine, backToStudy, exitExam, nextExamQuestion, openExam, prevExamQuestion, selectExamOption, selectMatchLeft, selectMatchRight, setExamChapter, sortDragStart, sortDrop, startCustomExam, startExam } from './render/exam-engine.js';
import { bindTooltipEvents, initGlossary, initTermTips, navigateToTerm, processTermTips } from './render/glossary.js';
import { closePanel, handlePanelAction, initPanels, openPanel } from './render/panels.js';
import { initQuiz, restoreQuizResults, selectOpt, submitQuiz } from './render/quiz.js';
import { renderSidebar, renderTabs, updateFooterProgress, updateSidebarProgress } from './render/sidebar-renderer.js';
import * as wrongbook from './render/wrongbook.js';
import { getSections } from './render/utils.js';

applyInitialTheme();

let course;
let store;
let sections = [];
let currentChapter = '';
let currentSection = '';
let studyStartTime = Date.now();

async function loadCourse(courseId, srcId, versionId) {
  // 带 src(服务端课程 id)时优先从服务端下载课程包字节(广场课 / 私人课 / 审核预览)。
  // versionId 用于审核预览指定的待审版本(默认取当前发布版)。
  if (srcId) {
    const bytes = await downloadCourse(srcId, versionId ? { version: versionId } : {});
    if (bytes) return parsePigeon(bytes);
    // 下载失败(未登录 / 网络 / 已删除):继续尝试同 key 的内置或本地课程,保证本地优先不破。
  }
  const builtin = findBuiltin(courseId);
  if (builtin) return loadPigeonFromUrl(`/${builtin.url}`);
  const local = await getLocalCourse(courseId);
  if (local) return parsePigeon(local.bytes);
  throw new Error(`找不到课程: ${courseId}`);
}

// 审核预览横幅:固定浮条,标明只读、不记录进度。
function showPreviewBanner() {
  const banner = document.createElement('div');
  banner.className = 'preview-banner';
  banner.innerHTML = `${icon('shield', { size: 16 })} <span>审核预览模式 · 仅查看课程内容,学习进度不会被记录</span>`;
  document.body.appendChild(banner);
}

function getStudyTime() {
  return store.get('studyTime', 0) + (Date.now() - studyStartTime);
}

function saveStudyTime() {
  if (!store) return;
  store.set('studyTime', getStudyTime());
  studyStartTime = Date.now();
}

function setFooterMode(mode) {
  const left = document.getElementById('footerNavLeft');
  const right = document.getElementById('footerNavRight');
  const progress = document.getElementById('footerProgress');
  const info = document.getElementById('footerExamInfo');
  if (mode === 'exam') {
    if (left) left.style.display = 'none';
    if (right) right.style.display = 'none';
    progress.style.display = 'none';
    info.style.display = 'block';
    const count = (course.quiz.examQuestions || []).filter((q) => q.chapter === currentChapter).length;
    let label = `模拟考试 · 第${currentChapter}章 · ${count}题`;
    if (document.getElementById('randomOrder')?.checked) label += ' · 随机顺序';
    if (document.getElementById('randomOptions')?.checked) label += ' · 随机选项';
    // 图标用 innerHTML,动态文本走 textContent 防注入
    info.innerHTML = `${icon('square-pen')} <span class="exam-info-text"></span>`;
    info.querySelector('.exam-info-text').textContent = label;
  } else {
    if (left) left.style.display = 'flex';
    if (right) right.style.display = 'flex';
    progress.style.display = 'block';
    info.style.display = 'none';
    updateFooterProgress(course.manifest, store, currentChapter);
  }
}

function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('show');
}

function switchChapter(chapterId) {
  if (document.getElementById('examView')?.classList.contains('active')) exitExam();
  currentChapter = chapterId;
  setExamChapter(chapterId);
  const firstSection = sections.find((section) => section.chapterId === chapterId);
  if (firstSection) currentSection = firstSection.id;
  document.querySelectorAll('.chapter-content').forEach((el) => { el.style.display = 'none'; });
  const chapterEl = document.getElementById(`ch-${chapterId}`);
  if (chapterEl) chapterEl.style.display = 'block';
  document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.chapter === chapterId));
  initTermTips();
  restoreQuizResults();
  setFooterMode('normal');
}

function recordLastCourse(sectionId) {
  const sec = sections.find((s) => s.id === sectionId);
  globalSet('lastCourse', {
    id: course.id,
    title: course.manifest.title,
    sectionId,
    sectionTitle: sec ? sec.title : '',
    at: Date.now(),
  });
}

function navigateTo(sectionId, cardId) {
  document.getElementById('examView')?.classList.remove('active');
  const chapter = sectionId.split('.')[0];
  if (chapter !== currentChapter) switchChapter(chapter);
  else document.getElementById(`ch-${chapter}`)?.style.setProperty('display', 'block');
  currentSection = sectionId;
  recordLastCourse(sectionId);
  setFooterMode('normal');
  if (cardId) {
    const card = document.getElementById(cardId);
    if (card) {
      setTimeout(() => {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        const header = card.querySelector('.card-header');
        if (header?.classList.contains('collapsed')) header.click();
      }, 80);
    }
  } else {
    document.getElementById(`overview-${sectionId.replace('.', '-')}`)?.scrollIntoView({ behavior: 'smooth' });
  }
  if (window.innerWidth <= 768) closeSidebar();
}

async function resetProgress() {
  if (!confirm('确定重置本课程学习进度、答题记录和错题本吗？')) return;
  // 用当前时间戳覆写(而非删除),使本地 LWW 时间戳比服务端新,
  // 防止重载后 initSync 拉回旧进度覆盖掉清空结果。
  const now = Date.now();
  const slots = ['progress', 'quiz', 'wrong', 'studyTime', 'exams'];
  const emptyOf = (slot) => (slot === 'wrong' || slot === 'exams' ? [] : slot === 'studyTime' ? 0 : {});
  slots.forEach((slot) => store.set(slot, emptyOf(slot)));
  // 同步推到服务端(fire-and-forget,失败静默,LWW 本地已领先)
  void Promise.allSettled(
    slots.map((slot) =>
      api('PUT', `/state/${encodeURIComponent(course.id)}/${slot}`, { data: emptyOf(slot), updated_at: now }),
    ),
  );
  location.reload();
}

function refreshProgress() {
  updateSidebarProgress(course.manifest, store);
  updateFooterProgress(course.manifest, store, currentChapter);
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'toggle-sidebar') document.getElementById('sidebar')?.classList.toggle('show');
    else if (action === 'switch-chapter') switchChapter(target.dataset.chapter);
    else if (action === 'toggle-tree') {
      target.classList.toggle('collapsed');
      target.closest('.tree-section')?.querySelectorAll('.tree-items').forEach((el) => el.classList.toggle('hidden'));
    } else if (action === 'navigate') navigateTo(target.dataset.section, target.dataset.card);
    else if (action === 'toggle-card') {
      target.classList.toggle('collapsed');
      const body = target.nextElementSibling;
      body?.classList.toggle('hidden');
      if (!target.classList.contains('collapsed')) {
        markRead(target.dataset.kpId, store, refreshProgress);
        if (body && !body.dataset.termsProcessed) {
          processTermTips(body);
          body.dataset.termsProcessed = '1';
        }
      }
    } else if (action === 'mark-mastered') markMastered(target.dataset.kpId, target, store, refreshProgress);
    else if (action === 'select-quiz') selectOpt(target);
    else if (action === 'submit-quiz') submitQuiz(target.dataset.qid);
    else if (action === 'open-panel') openPanel(target.dataset.panel);
    else if (action === 'close-panel') closePanel();
    else if (action === 'toggle-theme') toggleTheme();
    else if (action === 'open-exam') openExam(currentChapter);
    else if (action === 'start-exam') startExam();
    else if (action === 'prev-exam') prevExamQuestion();
    else if (action === 'next-exam') nextExamQuestion();
    else if (action === 'exit-exam') exitExam();
    else if (action === 'back-study') backToStudy();
    else if (action === 'exam-option') selectExamOption(target.dataset.qid, target.dataset.value);
    else if (action === 'match-left') selectMatchLeft(target.dataset.qid, target.dataset.value);
    else if (action === 'match-right') selectMatchRight(target.dataset.qid, target.dataset.value);
    else if (action === 'remove-wrong') wrongbook.removeWrongQuestion(target.dataset.id);
    else if (action === 'redo-wrong') wrongbook.redoWrong(target.dataset.id);
    else if (action === 'term-nav') navigateToTerm(target.dataset.term);
    else if (action === 'reset-progress') resetProgress();
    handlePanelAction(target);
  });

  document.addEventListener('input', (event) => {
    const target = event.target.closest('[data-action]');
    if (target) handlePanelAction(target);
  });

  document.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-action="sort-item"]');
    if (item) sortDragStart(item);
  });
  document.addEventListener('dragover', (event) => {
    if (event.target.closest('[data-action="sort-item"]')) event.preventDefault();
  });
  document.addEventListener('drop', (event) => {
    const item = event.target.closest('[data-action="sort-item"]');
    if (item) {
      event.preventDefault();
      sortDrop(item);
    }
  });
  window.addEventListener('beforeunload', saveStudyTime);

  // sandbox 块高度自适应:只认本页生成的 iframe(按 contentWindow 比对来源),按上报高度调整。
  window.addEventListener('message', (event) => {
    const h = event.data?.pigeonHeight;
    if (typeof h !== 'number' || !(h > 0)) return;
    document.querySelectorAll('iframe.sandbox-frame').forEach((frame) => {
      if (frame.contentWindow === event.source) frame.style.height = `${Math.ceil(h)}px`;
    });
  });
}

async function main() {
  hydrateIcons();                       // 顶栏/工具/计时等静态 chrome 的 SVG 图标
  await initSession();                  // 确认登录态(无后端则访客);须在 createStore 之前确定命名空间
  const params = new URLSearchParams(location.search);
  const courseId = params.get('course') || 'ic-packaging';
  const srcId = params.get('src');
  const versionId = params.get('v');
  const isPreview = params.get('preview') === '1';
  const target = params.get('section');
  try {
    course = await loadCourse(courseId, srcId, versionId);
  } catch (err) {
    document.getElementById('main').innerHTML = `<div class="overview-card"><h2>课程加载失败</h2><p>${pigeonErrorText(err)}</p></div>`;
    throw err;
  }
  store = createStore(course.id);
  // 审核预览态:屏蔽所有写入(进度/计时/错题),避免污染管理员档案,也不让管理员被计入课程学习人数。
  if (isPreview) { store.set = () => {}; showPreviewBanner(); }
  sections = getSections(course.manifest);
  currentChapter = course.manifest.chapters[0]?.id || '';
  currentSection = sections[0]?.id || '';
  document.title = `${course.manifest.title} · PigeonLib`;
  document.getElementById('courseLogo').textContent = course.manifest.title;

  renderTabs(document.getElementById('chapterTabs'), course.manifest);
  renderSidebar(document.getElementById('sidebar'), course.manifest, store);
  renderCourseContent(document.getElementById('main'), course, store);

  initGlossary(course.glossary);
  initQuiz({ quiz: course.quiz, store, wrong: wrongbook });
  initExamEngine({
    quiz: course.quiz,
    store,
    wrongbook,
    setFooterMode,
    navigateTo,
    getCurrentSection: () => currentSection,
  });
  wrongbook.initWrongbook({ store, startExam: startCustomExam, closePanel });
  initPanels({ manifest: course.manifest, store, getStudyTime });
  bindTooltipEvents();
  bindEvents();
  refreshProgress();
  restoreQuizResults();
  if (!isPreview) recordLastCourse(currentSection);
  if (target && sections.some((section) => section.id === target)) {
    navigateTo(target);
  }
  initAuthUI(document.getElementById('accountSlot'));
  initSync({ onApplied: () => { refreshProgress(); restoreQuizResults(); } });   // 登录则后台同步
}

document.addEventListener('DOMContentLoaded', main);
