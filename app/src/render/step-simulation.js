// step-simulation.js — stepSimulation 块:答题门控的连续仿真短片(契约见 docs/pigeon-format.md §2.5)。
//   支持两种形态:扁平 steps(单组无组头)与 groups(组头本身是下拉答题项,忠实原站两级计分)。
//   布局:页面内步骤列限高内滚 + 覆盖层全屏练习;移动端(≤768px)不渲染视频面板。
import { icon } from '../core/icons.js';
import { escapeHtml } from './utils.js';

const simulations = new Map();
const visibleMedia = new Set();     // 本次页面会话内答对过的仿真 → 才创建 video(防刷新直显尾帧)
const fullscreenIds = new Set();    // 处于全屏覆盖层的仿真(会话态,不持久化)
const memoryStates = new Map();     // 会话内状态兜底:访客 store 不持久化(get 恒返回 fallback),练习状态在此暂存
const STATE_VERSION = 3;

const MOBILE_QUERY = '(max-width:768px)';
function isMobile() {
  return typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches;
}

function simulationId(block) {
  return String(block.id || '').trim();
}

/** groups 与扁平 steps 二选一;同时出现取 groups 并警告(契约 §2.5)。扁平写法等价单组无组头。 */
function normalizeGroups(block) {
  if (Array.isArray(block.groups) && block.groups.length) {
    if (Array.isArray(block.steps) && block.steps.length) {
      console.warn('stepSimulation: groups 与 steps 同时出现,取 groups:', simulationId(block));
    }
    return block.groups.map((group) => ({ ...group, steps: Array.isArray(group.steps) ? group.steps : [] }));
  }
  return [{ steps: Array.isArray(block.steps) ? block.steps : [] }];
}

function groupHasHeader(group) {
  return Array.isArray(group.options) && group.options.length > 0;
}

/** 全部步骤按组序展平,步骤号全局 1 起(displayStep / clip / played 均用全局号)。 */
function flatSteps(block) {
  const list = [];
  normalizeGroups(block).forEach((group, groupIndex) => {
    group.steps.forEach((step) => list.push({ step, groupIndex: groupIndex + 1 }));
  });
  return list;
}

/** 计分口径 = 组头题数 + 全部步骤题数(契约 §2.5)。 */
function questionCounts(block) {
  const groups = normalizeGroups(block);
  const headers = groups.filter(groupHasHeader).length;
  const steps = groups.reduce((n, g) => n + g.steps.length, 0);
  return { headers, steps, total: headers + steps };
}

function defaultState() {
  return {
    version: STATE_VERSION,
    mode: 'practice',
    displayStep: 0,
    selected: {},        // { 全局步骤号: 选项序号(1 起) }
    groupSelected: {},   // { 组号(1 起): 选项序号(1 起) } — 组头题
    played: {},
    submitted: false,
    score: null,
    autoWalkthrough: false,
    openGroup: 0,        // 手风琴:0 = 自动(第一个未完成组);>0 = 显式展开该组;-1 = 全收起
  };
}

function allStates(store) {
  return store.get('simulations', {});
}

function stateFor(id, store) {
  // 访客/审核预览的 store 不持久化(get 恒返回 fallback),先查会话内暂存,保证练习流程可用。
  const stored = allStates(store)[id] || memoryStates.get(id);
  if (!stored || stored.version !== STATE_VERSION) return defaultState();
  return {
    ...defaultState(),
    ...stored,
    selected: { ...(stored.selected || {}) },
    groupSelected: { ...(stored.groupSelected || {}) },
    played: { ...(stored.played || {}) },
  };
}

function saveState(id, value, store) {
  memoryStates.set(id, value);
  const states = allStates(store);
  states[id] = value;
  store.set('simulations', states);
}

function stepAt(block, number) {
  return flatSteps(block)[number - 1]?.step || null;
}

function assetUrl(course, value) {
  return value ? course.resolveAsset(value) : '';
}

function isCorrect(step, selected) {
  return Number(selected) === Number(step?.answerIndex);
}

function allAnswered(block, state) {
  const groups = normalizeGroups(block);
  const headersOk = groups.every((group, index) => !groupHasHeader(group) || Number(state.groupSelected[index + 1] || 0) > 0);
  const steps = flatSteps(block);
  const stepsOk = steps.length > 0 && steps.every((_item, index) => Number(state.selected[index + 1] || 0) > 0);
  return headersOk && stepsOk;
}

function answeredCount(block, state) {
  const groups = normalizeGroups(block);
  let n = 0;
  groups.forEach((group, index) => {
    if (groupHasHeader(group) && Number(state.groupSelected[index + 1] || 0) > 0) n += 1;
  });
  flatSteps(block).forEach((_item, index) => {
    if (Number(state.selected[index + 1] || 0) > 0) n += 1;
  });
  return n;
}

/** 手风琴展开哪一组:显式值优先,否则第一个未答完的组;-1 全收起。 */
function openGroupIndex(block, state) {
  if (state.openGroup === -1) return -1;
  const groups = normalizeGroups(block);
  if (state.openGroup > 0 && state.openGroup <= groups.length) return state.openGroup;
  let number = 0;
  for (let g = 0, done = true; g < groups.length; g += 1) {
    done = !groupHasHeader(groups[g]) || Number(state.groupSelected[g + 1] || 0) > 0;
    for (const _step of groups[g].steps) {
      number += 1;
      if (Number(state.selected[number] || 0) === 0) done = false;
    }
    if (!done) return g + 1;
  }
  return groups.length; // 全部答完:停在最后一组
}

function renderSelect(id, options, selected, action, indexAttr, ariaLabel, extraClass = '') {
  return `<select class="step-simulation-choice${extraClass}" data-action="${action}" data-simulation-id="${escapeHtml(id)}" ${indexAttr} aria-label="${escapeHtml(ariaLabel)}">
    <option value="">请选择</option>
    ${(options || []).map((option, optionIndex) => `<option value="${optionIndex + 1}" ${Number(selected) === optionIndex + 1 ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
  </select>`;
}

/** 步骤行:mono 序号 | 题干 | 下拉(单行紧凑网格;答案模式下拉换成已验证答案文本)。提交后下拉框变色,答错时追加正确答案/解析。 */
function renderStep(id, step, number, state) {
  const selected = Number(state.selected[number] || 0);
  const current = state.displayStep === number;
  const correct = isCorrect(step, selected);
  const answerMode = state.mode === 'answer';
  const graded = state.submitted && !answerMode;          // 参考答案模式不带对错色
  const resultClass = graded ? (correct ? 'correct' : 'incorrect') : '';
  const selectClass = graded ? (correct ? ' correct' : ' incorrect') : '';
  const control = answerMode
    ? `<p class="step-simulation-answer">${escapeHtml(step.options?.[Number(step.answerIndex) - 1] || '')}</p>`
    : renderSelect(id, step.options, selected, 'simulation-select', `data-step="${number}"`, `步骤 ${number} 操作选择`, selectClass);
  const feedback = graded && !correct
    ? `<div class="step-simulation-correct-answer"><p>正确答案：${escapeHtml(step.options?.[Number(step.answerIndex) - 1] || '')}</p>${step.explain ? `<p class="step-simulation-explain">${escapeHtml(step.explain)}</p>` : ''}</div>`
    : '';
  return `<div class="step-simulation-step ${current ? 'active' : ''} ${resultClass}">
    <span class="step-simulation-step-number">${String(number).padStart(2, '0')}</span>
    <p class="step-simulation-prompt">${escapeHtml(step.prompt || '')}</p>
    ${control}
    ${feedback}
  </div>`;
}

/** 组:组头行(含组头下拉题,原站"功能区"一级)+ 手风琴组体。单组无组头时不渲染组壳。 */
function renderGroup(id, group, groupNumber, startNumber, state, open, single) {
  const stepsHtml = group.steps
    .map((step, index) => renderStep(id, step, startNumber + index, state))
    .join('');
  if (single && !groupHasHeader(group)) return stepsHtml;
  const selected = Number(state.groupSelected[groupNumber] || 0);
  const correct = Number(selected) === Number(group.answerIndex);
  const graded = state.submitted && groupHasHeader(group) && state.mode !== 'answer';
  const resultClass = graded ? (correct ? 'correct' : 'incorrect') : '';
  const feedback = graded && !correct
    ? `<div class="step-simulation-correct-answer"><p>正确答案：${escapeHtml(group.options?.[Number(group.answerIndex) - 1] || '')}</p></div>`
    : '';
  const selectClass = graded ? (correct ? ' correct' : ' incorrect') : '';
  const control = groupHasHeader(group)
    ? (state.mode === 'answer'
      ? `<p class="step-simulation-answer">${escapeHtml(group.options?.[Number(group.answerIndex) - 1] || '')}</p>`
      : renderSelect(id, group.options, selected, 'simulation-group-select', `data-group="${groupNumber}"`, `功能区 ${groupNumber} 选择`, selectClass))
    : '';
  return `<section class="step-simulation-group ${open ? 'open' : ''} ${resultClass}">
    <div class="step-simulation-group-head">
      <button type="button" class="step-simulation-group-toggle" data-action="simulation-toggle-group" data-simulation-id="${escapeHtml(id)}" data-group="${groupNumber}" aria-expanded="${open}">
        <span class="step-simulation-group-caret">${open ? '▾' : '▸'}</span>
        <span class="step-simulation-group-title">${escapeHtml(group.prompt || `分组 ${groupNumber}`)}</span>
      </button>
      ${control}
      ${feedback}
    </div>
    <div class="step-simulation-group-body" ${open ? '' : 'hidden'}>${stepsHtml}</div>
  </section>`;
}

function renderMedia(id, block, course, state) {
  if (isMobile()) return ''; // 移动端不渲染视频面板(答对以行级视觉确认代替);CSS 同步隐藏
  const mediaVisible = visibleMedia.has(id);
  const display = mediaVisible ? stepAt(block, state.displayStep) : null;
  const src = assetUrl(course, display?.clip);
  const poster = assetUrl(course, display?.poster || block.poster);
  const label = mediaVisible && state.displayStep > 0 ? `步骤 ${state.displayStep}` : '仿真视频';
  const replay = src
    ? `<button type="button" class="step-simulation-replay" data-action="simulation-replay" data-simulation-id="${escapeHtml(id)}" title="重新播放" aria-label="重新播放">${icon('rotate-ccw', { size: 16 })}</button>`
    : '';
  const player = src
    ? `<video class="step-simulation-video" data-simulation-id="${escapeHtml(id)}" data-media-step="${state.displayStep}" ${poster ? `poster="${escapeHtml(poster)}"` : ''} playsinline preload="metadata" controls><source src="${escapeHtml(src)}"></video>`
    : '<div class="step-simulation-video step-simulation-video-empty" aria-hidden="true"></div>';
  return `<div class="step-simulation-media">
    <div class="step-simulation-media-head">
      <div class="step-simulation-media-label">${escapeHtml(label)}</div>
      ${replay}
    </div>
    ${player}
  </div>`;
}

function renderSimulation(block, course, state = defaultState()) {
  const id = simulationId(block);
  if (!id) return '';
  const answerMode = state.mode === 'answer';
  const groups = normalizeGroups(block);
  const single = groups.length === 1 && !groupHasHeader(groups[0]);
  const counts = questionCounts(block);
  const fullscreen = fullscreenIds.has(id);
  const open = openGroupIndex(block, state);

  let startNumber = 1;
  const groupsHtml = groups.map((group, index) => {
    const html = renderGroup(id, group, index + 1, startNumber, state, single || open === index + 1, single);
    startNumber += group.steps.length;
    return html;
  }).join('');

  const controls = answerMode
    ? `<button type="button" class="step-simulation-command" data-action="simulation-walkthrough" data-simulation-id="${escapeHtml(id)}">重新播放</button>`
    : `<button type="button" class="step-simulation-command" data-action="simulation-submit" data-simulation-id="${escapeHtml(id)}" ${allAnswered(block, state) ? '' : 'disabled'}>提交</button>`;
  const percent = state.submitted && Number.isInteger(state.score) && counts.total > 0
    ? Math.round((state.score / counts.total) * 100)
    : null;
  const result = percent !== null
    ? `<p class="step-simulation-result" role="status">得分 ${percent} 分 · 正确率 ${state.score}/${counts.total}</p>`
    : '';
  const progress = answerMode ? '' : `<p class="step-simulation-progress" data-role="simulation-progress">进度 ${answeredCount(block, state)}/${counts.total}</p>`;
  const fullscreenBtn = `<button type="button" class="step-simulation-fullscreen-toggle" data-action="simulation-fullscreen" data-simulation-id="${escapeHtml(id)}" aria-label="${fullscreen ? '退出全屏' : '全屏练习'}">${icon(fullscreen ? 'minimize' : 'maximize', { size: 14 })} ${fullscreen ? '退出全屏' : '全屏练习'}</button>`;

  return `<div class="step-simulation ${fullscreen ? 'fullscreen' : ''}" data-simulation-id="${escapeHtml(id)}">
    <div class="step-simulation-header">
      <div class="step-simulation-heading">
        <p class="step-simulation-eyebrow">仿真练习</p>
        <h4>${escapeHtml(block.title || '')}</h4>
      </div>
      <div class="step-simulation-modes" role="group" aria-label="仿真模式">
        <button type="button" class="step-simulation-mode ${answerMode ? '' : 'active'}" data-action="simulation-mode" data-simulation-id="${escapeHtml(id)}" data-mode="practice">操作练习</button>
        <button type="button" class="step-simulation-mode ${answerMode ? 'active' : ''}" data-action="simulation-mode" data-simulation-id="${escapeHtml(id)}" data-mode="answer">参考答案</button>
      </div>
    </div>
    <div class="step-simulation-grid">
      <div class="step-simulation-steps">${groupsHtml}</div>
      ${renderMedia(id, block, course, state)}
    </div>
    <div class="step-simulation-actions">${progress}${result}${fullscreenBtn}${controls}</div>
  </div>`;
}

function replaceSimulation(id, store) {
  const entry = simulations.get(id);
  const root = document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"]`);
  if (!entry || !root) return;
  const active = document.activeElement?.dataset;
  const focusSelector = active?.step ? `[data-step="${CSS.escape(active.step)}"]`
    : active?.group && document.activeElement?.dataset?.action === 'simulation-group-select' ? `[data-action="simulation-group-select"][data-group="${CSS.escape(active.group)}"]`
      : '';
  root.outerHTML = renderSimulation(entry.block, entry.course, stateFor(id, store));
  wireMedia(id, store);
  if (focusSelector) {
    document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"] ${focusSelector}`)?.focus({ preventScroll: true });
  }
}

function updatePracticeView(id, entry, state) {
  const root = document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"]`);
  if (!root) return;
  const submit = root.querySelector('[data-action="simulation-submit"]');
  if (submit) submit.disabled = !allAnswered(entry.block, state);
  const progress = root.querySelector('[data-role="simulation-progress"]');
  if (progress) progress.textContent = `进度 ${answeredCount(entry.block, state)}/${questionCounts(entry.block).total}`;
  root.querySelector('.step-simulation-result')?.remove();
  root.querySelectorAll('.step-simulation-correct-answer').forEach((element) => element.remove());
  root.querySelectorAll('.step-simulation-step, .step-simulation-group, .step-simulation-choice').forEach((element) => element.classList.remove('correct', 'incorrect'));
}

function showStepMedia(id, entry, state, store) {
  const root = document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"]`);
  if (!root) return;
  root.querySelectorAll('.step-simulation-step').forEach((element) => element.classList.remove('active'));
  root.querySelector(`[data-step="${CSS.escape(String(state.displayStep))}"]`)?.closest('.step-simulation-step')?.classList.add('active');
  if (isMobile()) return; // 移动端无视频面板,行级高亮即是确认
  const media = root.querySelector('.step-simulation-media');
  if (!media) return;
  visibleMedia.add(id);
  media.outerHTML = renderMedia(id, entry.block, entry.course, state);
  wireMedia(id, store);
  void playDisplayed(id, store);
}

function holdTailFrame(video) {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    video.currentTime = Math.max(0, video.duration - 0.04);
  }
}

async function playDisplayed(id, store) {
  const root = document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"]`);
  const video = root?.querySelector('.step-simulation-video');
  if (!video?.querySelector('source')?.getAttribute('src')) return;
  try {
    video.currentTime = 0;
    await video.play();
  } catch {
    // Browser autoplay policy may require the user to press the native play control.
  }
}

function wireMedia(id, store) {
  const root = document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"]`);
  const video = root?.querySelector('.step-simulation-video');
  if (!video || video.dataset.wired) return;
  video.dataset.wired = '1';
  const initialState = stateFor(id, store);
  const initialStep = Number(video.dataset.mediaStep);
  if (initialState.played[initialStep]) {
    if (video.readyState >= 1) holdTailFrame(video);
    else video.addEventListener('loadedmetadata', () => holdTailFrame(video), { once: true });
  }
  video.addEventListener('ended', () => {
    const entry = simulations.get(id);
    if (!entry) return;
    const state = stateFor(id, store);
    const current = Number(video.dataset.mediaStep);
    if (!current) return;
    if (state.mode === 'answer' && state.autoWalkthrough) {
      const next = current + 1;
      if (next <= flatSteps(entry.block).length) {
        state.displayStep = next;
        saveState(id, state, store);
        replaceSimulation(id, store);
        void playDisplayed(id, store);
        return;
      }
    }
    state.autoWalkthrough = false;
    state.played[current] = true;
    saveState(id, state, store);
    holdTailFrame(video);
  });
}

/* ---- 覆盖层全屏(纯 fixed 覆盖层,非原生 Fullscreen API;Esc 或按钮退出) ---- */

let escWired = false;

function setFullscreen(id, store, on) {
  if (on) fullscreenIds.add(id);
  else fullscreenIds.delete(id);
  document.body.classList.toggle('sim-overlay-lock', fullscreenIds.size > 0);
  replaceSimulation(id, store);
  if (on) {
    document.querySelector(`.step-simulation[data-simulation-id="${CSS.escape(id)}"] .step-simulation-fullscreen-toggle`)?.focus({ preventScroll: true });
    // replaceSimulation 只挂 ended/尾帧,不自动播;进全屏后若当前步骤有可见视频则续播,避免停在尾帧。
    if (visibleMedia.has(id) && stateFor(id, store).displayStep > 0) void playDisplayed(id, store);
  }
}

function wireEscape(store) {
  if (escWired) return;
  escWired = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !fullscreenIds.size) return;
    for (const id of [...fullscreenIds]) setFullscreen(id, store, false);
  });
}

/** 组件卸载/切卡时强制退出覆盖层(main-learn 在 toggle-card 与换章时调用)。 */
export function closeStepSimulationFullscreen(store) {
  for (const id of [...fullscreenIds]) setFullscreen(id, store, false);
}

export function renderStepSimulation(block, course) {
  const id = simulationId(block);
  if (!id) return '';
  simulations.set(id, { block, course });
  visibleMedia.delete(id);
  fullscreenIds.delete(id);
  return renderSimulation(block, course);
}

export function initStepSimulations(store) {
  wireEscape(store);
  for (const id of simulations.keys()) replaceSimulation(id, store);
}

export function handleStepSimulationAction(target, store) {
  const id = target.dataset.simulationId;
  const entry = simulations.get(id);
  if (!entry) return false;
  const state = stateFor(id, store);
  const stepNumber = Number(target.dataset.step);
  const groupNumber = Number(target.dataset.group);

  if (target.dataset.action === 'simulation-mode') {
    const toAnswer = target.dataset.mode === 'answer';
    state.mode = toAnswer ? 'answer' : 'practice';
    // 切到「参考答案」直接从第一段连播(桌面端);移动端无视频面板,仅列答案文本。
    const autoPlay = toAnswer && flatSteps(entry.block).length > 0 && !isMobile();
    state.autoWalkthrough = autoPlay;
    if (autoPlay) {
      state.displayStep = 1;
      state.played = {};
      visibleMedia.add(id);
    } else {
      visibleMedia.delete(id);
    }
    saveState(id, state, store);
    replaceSimulation(id, store);
    if (autoPlay) void playDisplayed(id, store);
    return true;
  }
  if (target.dataset.action === 'simulation-select') {
    const step = stepAt(entry.block, stepNumber);
    if (!step || state.mode !== 'practice') return true;
    const selected = Number(target.value || 0);
    state.selected[stepNumber] = selected;
    state.submitted = false;
    state.score = null;
    const correct = selected && isCorrect(step, selected);
    if (correct) {
      state.displayStep = stepNumber;
      state.played[stepNumber] = false;
    }
    saveState(id, state, store);
    updatePracticeView(id, entry, state);
    if (correct) showStepMedia(id, entry, state, store);
    return true;
  }
  if (target.dataset.action === 'simulation-group-select') {
    const group = normalizeGroups(entry.block)[groupNumber - 1];
    if (!group || !groupHasHeader(group) || state.mode !== 'practice') return true;
    state.groupSelected[groupNumber] = Number(target.value || 0);
    state.submitted = false;
    state.score = null;
    // 组头选对不播视频(原站组头无短片,契约 §2.5),仅更新进度/提交可用态
    saveState(id, state, store);
    updatePracticeView(id, entry, state);
    return true;
  }
  if (target.dataset.action === 'simulation-toggle-group') {
    state.openGroup = openGroupIndex(entry.block, state) === groupNumber ? -1 : groupNumber;
    saveState(id, state, store);
    replaceSimulation(id, store);
    return true;
  }
  if (target.dataset.action === 'simulation-fullscreen') {
    setFullscreen(id, store, !fullscreenIds.has(id));
    return true;
  }
  if (target.dataset.action === 'simulation-submit') {
    if (!allAnswered(entry.block, state)) return true;
    const groups = normalizeGroups(entry.block);
    let score = 0;
    groups.forEach((group, index) => {
      if (groupHasHeader(group) && Number(state.groupSelected[index + 1]) === Number(group.answerIndex)) score += 1;
    });
    flatSteps(entry.block).forEach((item, index) => {
      if (isCorrect(item.step, state.selected[index + 1])) score += 1;
    });
    state.submitted = true;
    state.score = score;
    saveState(id, state, store);
    replaceSimulation(id, store);
    return true;
  }
  if (target.dataset.action === 'simulation-walkthrough') {
    if (!flatSteps(entry.block).length) return true;
    state.mode = 'answer';
    state.autoWalkthrough = true;
    state.displayStep = 1;
    state.played = {};
    visibleMedia.add(id);
    saveState(id, state, store);
    replaceSimulation(id, store);
    void playDisplayed(id, store);
    return true;
  }
  if (target.dataset.action === 'simulation-replay') {
    void playDisplayed(id, store);
    return true;
  }
  return false;
}
