import { findBuiltin, getLocalCourse } from './core/course-registry.js';
import { loadPigeonFromUrl, parsePigeon, pigeonErrorText } from './core/pigeon-loader.js';
import { createStore } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';
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

async function loadCourse(courseId) {
  const builtin = findBuiltin(courseId);
  if (builtin) return loadPigeonFromUrl(`/${builtin.url}`);
  const local = await getLocalCourse(courseId);
  if (local) return parsePigeon(local.bytes);
  throw new Error(`找不到课程: ${courseId}`);
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
    left.style.display = 'none';
    right.style.display = 'none';
    progress.style.display = 'none';
    info.style.display = 'block';
    const count = (course.quiz.examQuestions || []).filter((q) => q.chapter === currentChapter).length;
    let text = `📝 模拟考试 · 第${currentChapter}章 · ${count}题`;
    if (document.getElementById('randomOrder')?.checked) text += ' · 随机顺序';
    if (document.getElementById('randomOptions')?.checked) text += ' · 随机选项';
    info.textContent = text;
  } else {
    left.style.display = 'flex';
    right.style.display = 'flex';
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

function navigateTo(sectionId, cardId) {
  document.getElementById('examView')?.classList.remove('active');
  const chapter = sectionId.split('.')[0];
  if (chapter !== currentChapter) switchChapter(chapter);
  else document.getElementById(`ch-${chapter}`)?.style.setProperty('display', 'block');
  currentSection = sectionId;
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

function prevSection() {
  const idx = sections.findIndex((section) => section.id === currentSection);
  if (idx > 0) navigateTo(sections[idx - 1].id);
}

function nextSection() {
  const idx = sections.findIndex((section) => section.id === currentSection);
  if (idx >= 0 && idx < sections.length - 1) navigateTo(sections[idx + 1].id);
}

function resetProgress() {
  if (!confirm('确定重置本课程学习进度、答题记录和错题本吗？')) return;
  store.clear();
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
      target.nextElementSibling?.classList.toggle('hidden');
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
    else if (action === 'prev-section') prevSection();
    else if (action === 'next-section') nextSection();
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
}

async function main() {
  const params = new URLSearchParams(location.search);
  const courseId = params.get('course') || 'ic-packaging';
  try {
    course = await loadCourse(courseId);
  } catch (err) {
    document.getElementById('main').innerHTML = `<div class="overview-card"><h2>课程加载失败</h2><p>${pigeonErrorText(err)}</p></div>`;
    throw err;
  }
  store = createStore(course.id);
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
}

document.addEventListener('DOMContentLoaded', main);
