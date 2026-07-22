// main-learn.js — 学习页脚本:加载课程、串联各渲染器、绑定交互事件、图标水合、进度持久化。
import { findBuiltin, getLocalCourse } from './core/course-registry.js';
import { loadPigeonFromUrl, parsePigeon, pigeonErrorText } from './core/pigeon-loader.js';
import { downloadCourse } from './core/course-source.js';
import { createStore, globalGet, globalSet } from './core/store.js';
import { applyInitialTheme, toggleTheme } from './core/theme.js';
import { icon, hydrateIcons } from './core/icons.js';
import { initSession, api } from './core/session.js';
import { initSync } from './core/sync.js';
import { initAuthUI } from './core/auth-ui.js';
import { activateContentTab, markMastered, markRead, renderCourseContent, sandboxTokenSnapshot } from './render/content-renderer.js';
import { initExamEngine, backToStudy, exitExam, nextExamQuestion, openExam, prevExamQuestion, selectExamOption, selectMatchLeft, selectMatchRight, setExamChapter, sortDragStart, sortDrop, startCustomExam, startExam } from './render/exam-engine.js';
import { bindTooltipEvents, initGlossary, initTermTips, navigateToTerm, processTermTips } from './render/glossary.js';
import { closePanel, handlePanelAction, initPanels, openPanel } from './render/panels.js';
import { initQuiz, restoreQuizResults, selectOpt, submitQuiz } from './render/quiz.js';
import { getReadingSectionId, renderSidebar, renderTabs, setSidebarChapter, setSidebarSection, toggleSidebarChapter, updateFooterProgress, updateSidebarProgress } from './render/sidebar-renderer.js';
import { closeStepSimulationFullscreen, handleStepSimulationAction, initStepSimulations } from './render/step-simulation.js';
import { handleParamSelectAction, initParamSelects } from './render/param-select.js';
import * as wrongbook from './render/wrongbook.js';
import { getSections } from './render/utils.js';

applyInitialTheme();

let course;
let store;
let sections = [];
let currentChapter = '';
let currentSection = '';
let studyStartTime = Date.now();
let navigationRequestId = 0;
let readingSyncFrame = 0;
let readingResizeObserver;
let readingNavigationRequestId = 0;
let readingNavigationTimer = 0;
let readingNavigationTarget = null;
const READING_NAVIGATION_SETTLE_MS = 1200;

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
    info.style.display = 'flex';
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

function syncReadingPosition() {
  readingSyncFrame = 0;
  if (readingNavigationRequestId) return;
  if (document.getElementById('examView')?.classList.contains('active')) return;
  const main = document.getElementById('main');
  const nextSection = getReadingSectionId(sections, main, currentChapter);
  if (!nextSection || nextSection === currentSection) return;
  currentSection = nextSection;
  setSidebarSection(currentSection);
  recordLastCourse(currentSection);
}

function releaseReadingPositionSync(requestId) {
  if (readingNavigationRequestId !== requestId) return;
  clearTimeout(readingNavigationTimer);
  readingNavigationTimer = 0;
  readingNavigationRequestId = 0;
  readingNavigationTarget = null;
  scheduleReadingPositionSync();
}

function scheduleReadingPositionRelease(requestId, delay = READING_NAVIGATION_SETTLE_MS) {
  clearTimeout(readingNavigationTimer);
  readingNavigationTimer = setTimeout(() => releaseReadingPositionSync(requestId), delay);
}

function cancelReadingNavigation() {
  if (!readingNavigationRequestId) return;
  releaseReadingPositionSync(readingNavigationRequestId);
}

function reconcileReadingNavigation() {
  if (!readingNavigationRequestId || !readingNavigationTarget) {
    scheduleReadingPositionSync();
    return;
  }
  const main = document.getElementById('main');
  if (!main) return;
  if (Math.abs(readingNavigationTarget.getBoundingClientRect().top - main.getBoundingClientRect().top) > 16) {
    readingNavigationTarget.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
  }
  scheduleReadingPositionRelease(readingNavigationRequestId);
}

function scheduleReadingPositionSync() {
  if (readingSyncFrame) return;
  readingSyncFrame = requestAnimationFrame(syncReadingPosition);
}

function initReadingPositionTracking() {
  const main = document.getElementById('main');
  if (!main) return;
  main.addEventListener('scroll', scheduleReadingPositionSync, { passive: true });
  main.addEventListener('scrollend', () => {
    if (readingNavigationRequestId) scheduleReadingPositionRelease(readingNavigationRequestId);
    else scheduleReadingPositionSync();
  });
  main.addEventListener('wheel', cancelReadingNavigation, { passive: true });
  main.addEventListener('touchstart', cancelReadingNavigation, { passive: true });
  if (window.ResizeObserver) {
    readingResizeObserver = new ResizeObserver(reconcileReadingNavigation);
    document.querySelectorAll('.chapter-content').forEach((chapter) => readingResizeObserver.observe(chapter));
  }
  scheduleReadingPositionSync();
}

const cardTransitionHandlers = new WeakMap();

function stopCardTransition(body) {
  const handler = cardTransitionHandlers.get(body);
  if (handler) body.removeEventListener('transitionend', handler);
  cardTransitionHandlers.delete(body);
}

function setCardExpanded(header, expanded, onExpanded) {
  const card = header?.closest('.knowledge-card');
  if (!card) return;
  const body = header.nextElementSibling;
  header.classList.toggle('collapsed', !expanded);
  if (!body) return;
  stopCardTransition(body);
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) {
    body.style.removeProperty('height');
    body.style.removeProperty('transition');
    body.classList.remove('is-animating');
    body.classList.toggle('hidden', !expanded);
    if (expanded) onExpanded?.();
    return;
  }

  // 内层始终按自然高度排版，只裁切外层高度，避免每帧重排表格、图片和仿真内容。
  const startHeight = body.classList.contains('hidden') ? 0 : body.getBoundingClientRect().height;
  body.classList.remove('hidden');
  body.classList.add('is-animating');
  body.style.transition = 'none';
  body.style.height = `${startHeight}px`;
  void body.offsetHeight;
  body.style.removeProperty('transition');
  void body.offsetHeight;

  const endHeight = expanded
    ? body.querySelector('.card-body-content')?.scrollHeight || body.scrollHeight
    : 0;
  body.style.height = `${endHeight}px`;

  const finalize = () => {
    stopCardTransition(body);
    body.style.removeProperty('height');
    body.classList.remove('is-animating');
    if (!expanded && header.classList.contains('collapsed')) body.classList.add('hidden');
    else if (expanded && !header.classList.contains('collapsed')) onExpanded?.();
  };
  if (Math.abs(endHeight - startHeight) < 1) {
    finalize();
    return;
  }
  const finishTransition = (event) => {
    if (event.target === body && event.propertyName === 'height') finalize();
  };
  cardTransitionHandlers.set(body, finishTransition);
  body.addEventListener('transitionend', finishTransition);
}

function switchChapter(chapterId) {
  if (document.getElementById('examView')?.classList.contains('active')) exitExam();
  closeStepSimulationFullscreen(store);   // 换章时强制退出仿真全屏覆盖层
  currentChapter = chapterId;
  setExamChapter(chapterId);
  const firstSection = sections.find((section) => section.chapterId === chapterId);
  if (firstSection) currentSection = firstSection.id;
  document.getElementById('main').scrollTop = 0;
  document.querySelectorAll('.chapter-content').forEach((el) => { el.style.display = 'none'; });
  const chapterEl = document.getElementById(`ch-${chapterId}`);
  if (chapterEl) chapterEl.style.display = 'block';
  document.querySelectorAll('.tabs .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.chapter === chapterId));
  setSidebarChapter(chapterId);
  setSidebarSection(currentSection);
  initTermTips();
  restoreQuizResults();
  setFooterMode('normal');
  scheduleReadingPositionSync();
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
  const requestId = ++navigationRequestId;
  readingNavigationRequestId = requestId;
  readingNavigationTarget = null;
  scheduleReadingPositionRelease(requestId, 4000);
  const scroll = (element) => {
    if (!element || requestId !== navigationRequestId) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const main = document.getElementById('main');
    const alreadyAligned = main && Math.abs(element.getBoundingClientRect().top - main.getBoundingClientRect().top) <= 16;
    readingNavigationTarget = element;
    scheduleReadingPositionRelease(requestId, 4000);
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start', inline: 'nearest' });
    if (reducedMotion || alreadyAligned) requestAnimationFrame(() => scheduleReadingPositionRelease(requestId));
  };
  document.getElementById('examView')?.classList.remove('active');
  const chapter = sectionId.split('.')[0];
  if (chapter !== currentChapter) switchChapter(chapter);
  else document.getElementById(`ch-${chapter}`)?.style.setProperty('display', 'block');
  currentSection = sectionId;
  setSidebarSection(currentSection);
  recordLastCourse(sectionId);
  setFooterMode('normal');
  if (cardId) {
    const card = document.getElementById(cardId);
    if (card) {
      const header = card.querySelector('.card-header');
      const body = header?.nextElementSibling;
      if (!header?.classList.contains('collapsed') || !body) scroll(card);
      else {
        const finishNavigation = (event) => {
          if (event && (event.target !== body || event.propertyName !== 'height')) return;
          body.removeEventListener('transitionend', finishNavigation);
          scroll(card);
        };
        body.addEventListener('transitionend', finishNavigation);
        header.click();
        requestAnimationFrame(() => {
          if (!body.classList.contains('is-animating')) finishNavigation();
        });
      }
    }
  } else {
    scroll(document.getElementById(`overview-${sectionId.replace('.', '-')}`));
  }
  if (window.innerWidth <= 768) closeSidebar();
}

function prevSection() {
  const index = sections.findIndex((section) => section.id === currentSection);
  if (index > 0) navigateTo(sections[index - 1].id);
}

function nextSection() {
  const index = sections.findIndex((section) => section.id === currentSection);
  if (index >= 0 && index < sections.length - 1) navigateTo(sections[index + 1].id);
}

async function resetProgress() {
  if (!confirm('确定重置本课程学习进度、答题记录和错题本吗？')) return;
  // 用当前时间戳覆写(而非删除),使本地 LWW 时间戳比服务端新,
  // 防止重载后 initSync 拉回旧进度覆盖掉清空结果。
  const now = Date.now();
  const slots = ['progress', 'quiz', 'wrong', 'studyTime', 'exams', 'simulations'];
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
    if (action !== 'simulation-select' && action !== 'simulation-group-select' && handleStepSimulationAction(target, store)) return;
    if (action !== 'param-select' && handleParamSelectAction(target, store)) return;
    if (action === 'toggle-sidebar') document.getElementById('sidebar')?.classList.toggle('show');
    else if (action === 'switch-chapter') switchChapter(target.dataset.chapter);
    else if (action === 'switch-sidebar-chapter') {
      if (target.dataset.chapter === currentChapter) toggleSidebarChapter(target.dataset.chapter);
      else switchChapter(target.dataset.chapter);
    }
    else if (action === 'navigate') navigateTo(target.dataset.section, target.dataset.card);
    else if (action === 'toggle-card') {
      const expanded = target.classList.contains('collapsed');
      const body = target.nextElementSibling;
      const afterExpand = expanded ? () => {
        markRead(target.dataset.kpId, store, refreshProgress);
        if (!body || body.dataset.termsProcessed) return;
        body.dataset.termsProcessed = 'pending';
        const processTerms = () => {
          if (body.dataset.termsProcessed !== 'pending') return;
          processTermTips(body);
          body.dataset.termsProcessed = '1';
        };
        if ('requestIdleCallback' in window) window.requestIdleCallback(processTerms, { timeout: 800 });
        else setTimeout(processTerms, 0);
      } : undefined;
      setCardExpanded(target, expanded, afterExpand);
      if (!expanded) closeStepSimulationFullscreen(store); // 收卡时退出仿真全屏
    } else if (action === 'mark-mastered') markMastered(target.dataset.kpId, target, store, refreshProgress);
    else if (action === 'switch-content-tab') activateContentTab(target);
    else if (action === 'select-quiz') selectOpt(target);
    else if (action === 'submit-quiz') submitQuiz(target.dataset.qid);
    else if (action === 'open-panel') openPanel(target.dataset.panel);
    else if (action === 'close-panel') closePanel();
    else if (action === 'switch-sandbox-mode') switchSandboxMode(target);
    else if (action === 'toggle-theme') { toggleTheme(); broadcastSandboxTheme(); }
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

  document.addEventListener('change', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    if (handleStepSimulationAction(target, store)) return;
    if (handleParamSelectAction(target, store)) return;
    handlePanelAction(target);
  });

  document.addEventListener('keydown', (event) => {
    const target = event.target.closest('[data-action="switch-content-tab"]');
    if (!target || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...target.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
    const current = tabs.indexOf(target);
    const next = event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs[tabs.length - 1]
        : tabs[(current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    event.preventDefault();
    activateContentTab(next, true);
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
  window.addEventListener('pagehide', () => course?.revoke());

  // sandbox 消息只认本页生成的 iframe(contentWindow 比对):统一处理高度、主题/模式握手与练习状态。
  window.addEventListener('message', (event) => {
    const frame = sandboxFrameFromSource(event.source);
    if (!frame) return;
    if (event.data?.type === 'pigeon-theme-request') {
      sendSandboxTheme(frame);
      const mode = frame.closest('.sandbox-wrapper')?.dataset.sandboxMode;
      if (mode) sendSandboxMode(frame, mode);
      return;
    }
    if (event.data?.type === 'pigeon-sandbox-ready') {
      restoreSandboxFrame(frame);
      return;
    }
    if (event.data?.type === 'pigeon-sandbox-mode') {
      const mode = event.data.mode;
      if (mode !== 'practice' && mode !== 'answer') return;
      const wrapper = frame.closest('.sandbox-wrapper[data-sandbox-mode]');
      if (wrapper) updateSandboxModeControls(wrapper, mode);
      return;
    }
    if (event.data?.type === 'pigeon-sandbox-state') {
      saveSandboxControls(frame, event.data.controls);
      return;
    }
    if (event.data?.type === 'pigeon-score') {
      saveSandboxScore(frame, event.data);
      return;
    }
    if (event.data?.type === 'pigeon-score-clear') {
      const wrapper = frame.closest('.sandbox-wrapper');
      wrapper?.querySelector('.sandbox-score-chip')?.remove();
      if (wrapper) wrapper.dataset.sandboxScoreClear = 'pending';
      return;
    }
    const h = event.data?.pigeonHeight;
    if (typeof h !== 'number' || !(h > 0)) return;
    frame.style.height = `${Math.ceil(h)}px`;
  });
}

const SANDBOX_STATE_VERSION = 1;

function sandboxFrameFromSource(source) {
  return [...document.querySelectorAll('iframe.sandbox-frame')]
    .find((frame) => frame.contentWindow === source) || null;
}

function sandboxStateEntry(frame) {
  const key = frame.closest('.sandbox-wrapper')?.dataset.sandboxKey;
  if (!key || !store) return null;
  const states = store.get('simulations', {});
  return { key, states, value: states[key] || {} };
}

function sanitizeSandboxControls(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 200).flatMap((item) => {
    const index = Number(item?.index);
    if (!Number.isInteger(index) || index < 0 || index > 1999) return [];
    const checked = typeof item.checked === 'boolean' ? item.checked : null;
    const controlValue = Array.isArray(item.value)
      ? item.value.slice(0, 50).map((entry) => String(entry).slice(0, 500))
      : String(item.value ?? '').slice(0, 500);
    return [{ index, value: controlValue, checked }];
  });
}

function saveSandboxControls(frame, controls) {
  const entry = sandboxStateEntry(frame);
  if (!entry) return;
  const wrapper = frame.closest('.sandbox-wrapper');
  const next = {
    ...entry.value,
    version: SANDBOX_STATE_VERSION,
    controls: sanitizeSandboxControls(controls),
  };
  if (wrapper?.dataset.sandboxScoreClear === 'pending') {
    delete next.score;
    delete wrapper.dataset.sandboxScoreClear;
  }
  entry.states[entry.key] = next;
  store.set('simulations', entry.states);
}

function normalizedSandboxScore(value) {
  const score = Number(value?.score);
  const total = Number(value?.total);
  if (!Number.isInteger(score) || !Number.isInteger(total) || total <= 0 || score < 0 || score > total) return null;
  const detail = typeof value.detail === 'string' ? value.detail.slice(0, 200) : '';
  return { score, total, detail };
}

function renderSandboxScore(wrapper, result) {
  if (!wrapper || !result) return;
  let chip = wrapper.querySelector('.sandbox-score-chip');
  if (!chip) {
    chip = document.createElement('p');
    chip.className = 'sandbox-score-chip';
    wrapper.insertBefore(chip, wrapper.querySelector('iframe.sandbox-frame'));
  }
  const percent = Math.round((result.score / result.total) * 100);
  chip.textContent = `得分 ${percent} 分 · 正确率 ${result.score}/${result.total}${result.detail ? `　${result.detail}` : ''}`;
  chip.dataset.correct = result.score === result.total ? 'true' : 'false';
}

function saveSandboxScore(frame, value) {
  const result = normalizedSandboxScore(value);
  const entry = sandboxStateEntry(frame);
  const wrapper = frame.closest('.sandbox-wrapper');
  if (!result || !entry || !wrapper) return;
  delete wrapper.dataset.sandboxScoreClear;
  entry.states[entry.key] = { ...entry.value, version: SANDBOX_STATE_VERSION, score: result };
  store.set('simulations', entry.states);
  renderSandboxScore(wrapper, result);
}

function restoreSandboxFrame(frame) {
  const entry = sandboxStateEntry(frame);
  if (!entry || entry.value.version !== SANDBOX_STATE_VERSION) return;
  try {
    frame.contentWindow?.postMessage({ type: 'pigeon-sandbox-restore', controls: entry.value.controls || [] }, '*');
  } catch { /* iframe 尚未就绪时由下一次 ready 消息重试 */ }
  renderSandboxScore(frame.closest('.sandbox-wrapper'), normalizedSandboxScore(entry.value.score));
}

function restoreSandboxStates() {
  document.querySelectorAll('iframe.sandbox-frame').forEach(restoreSandboxFrame);
}

// 主题切换时把最新令牌快照广播给所有 sandbox iframe(sandbox 无 same-origin,只能 postMessage)。
function sendSandboxTheme(frame) {
  try {
    frame.contentWindow?.postMessage({ type: 'pigeon-theme', tokens: sandboxTokenSnapshot() }, '*');
  } catch { /* iframe 尚未就绪时静默;其 load 后会主动握手补拿 */ }
}

function broadcastSandboxTheme() {
  document.querySelectorAll('iframe.sandbox-frame').forEach(sendSandboxTheme);
}

function updateSandboxModeControls(wrapper, mode) {
  wrapper.dataset.sandboxMode = mode;
  wrapper.querySelectorAll('[data-action="switch-sandbox-mode"]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function sendSandboxMode(frame, mode) {
  try {
    frame.contentWindow?.postMessage({ type: 'pigeon-sandbox-mode', mode }, '*');
  } catch { /* iframe 尚未就绪时由 pigeon-theme-request 握手补发 */ }
}

function switchSandboxMode(button) {
  const wrapper = button.closest('.sandbox-wrapper[data-sandbox-mode]');
  const mode = button.dataset.mode;
  if (!wrapper || (mode !== 'practice' && mode !== 'answer')) return;
  updateSandboxModeControls(wrapper, mode);
  wrapper.querySelector('.sandbox-score-chip')?.remove();
  const frame = wrapper.querySelector('iframe.sandbox-frame');
  if (frame) sendSandboxMode(frame, mode);
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
  const lastCourse = globalGet('lastCourse', null);
  const resumeSection = lastCourse?.id === course.id
    ? sections.find((section) => section.id === lastCourse?.sectionId)
    : null;
  currentChapter = resumeSection?.chapterId || course.manifest.chapters[0]?.id || '';
  currentSection = resumeSection?.id || sections[0]?.id || '';
  document.title = `${course.manifest.title} · PigeonLib`;
  document.getElementById('courseLogo').textContent = course.manifest.title;

  renderTabs(document.getElementById('chapterTabs'), course.manifest);
  document.querySelectorAll('.tabs .tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.chapter === currentChapter);
  });
  renderSidebar(document.getElementById('sidebar'), course.manifest, store, currentChapter, currentSection);
  renderCourseContent(document.getElementById('main'), course, store);
  if (currentChapter !== course.manifest.chapters[0]?.id) {
    document.querySelectorAll('.chapter-content').forEach((chapter) => {
      chapter.style.display = chapter.id === `ch-${currentChapter}` ? 'block' : 'none';
    });
  }
  initStepSimulations(store);
  initParamSelects(store);

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
  initReadingPositionTracking();
  if (!isPreview) recordLastCourse(currentSection);
  if (target && sections.some((section) => section.id === target)) {
    navigateTo(target);
  } else if (resumeSection) {
    navigateTo(resumeSection.id);
  }
  initAuthUI(document.getElementById('accountSlot'));
  initSync({
    onApplied: () => {
      refreshProgress();
      restoreQuizResults();
      initStepSimulations(store);
      initParamSelects(store);
      restoreSandboxStates();
    },
  });   // 登录则后台同步
}

document.addEventListener('DOMContentLoaded', main);
