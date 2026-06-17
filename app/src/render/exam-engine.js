// exam-engine.js — 章节考试引擎:单选/判断/排序/匹配的渲染、作答、计时、判分与错题汇总。
import { icon } from '../core/icons.js';
import { escapeHtml, shuffle } from './utils.js';
import { renderAnswerDetail } from './wrongbook.js';

let context;
let currentChapter;
let questions = [];
let currentIdx = 0;
let answers = {};
let startTime = 0;
let timerInterval = null;
let sortDragIdx = null;

export function initExamEngine(ctx) {
  context = ctx;
}

export function setExamChapter(chapter) {
  currentChapter = chapter;
}

function clearExamTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
}

function getTypeLabel(type) {
  return { single: '单选题', judge: '判断题', sort: '排序题', match: '匹配题' }[type] || type;
}

function prepareQuestion(q, randomOptions) {
  const next = { ...q };
  if (randomOptions && next.type === 'single' && Array.isArray(next.options)) {
    next.options = shuffle(next.options);
  }
  if (next.type === 'match' && Array.isArray(next.right)) {
    next.right = shuffle(next.right);
  }
  return next;
}

export function openExam(chapter = currentChapter) {
  clearExamTimer();
  currentChapter = chapter;
  questions = (context.quiz.examQuestions || []).filter((q) => q.chapter === chapter);
  document.querySelectorAll('.chapter-content').forEach((el) => { el.style.display = 'none'; });
  document.getElementById('examView')?.classList.add('active');
  document.getElementById('examStart').style.display = 'block';
  document.getElementById('examProgress').style.display = 'none';
  document.getElementById('examResult').style.display = 'none';
  context.setFooterMode('exam');
}

export function startExam(customQuestions = null) {
  clearExamTimer();
  const randomOrder = document.getElementById('randomOrder')?.checked;
  const randomOptions = document.getElementById('randomOptions')?.checked;
  const source = customQuestions || questions;
  questions = (randomOrder ? shuffle(source) : source.slice()).map((q) => prepareQuestion(q, randomOptions));
  currentIdx = 0;
  answers = {};
  startTime = Date.now();
  document.getElementById('examStart').style.display = 'none';
  document.getElementById('examProgress').style.display = 'block';
  document.getElementById('examResult').style.display = 'none';
  startExamTimer();
  renderExamQuestion();
  context.setFooterMode('exam');
}

export function startCustomExam(customQuestions) {
  openExam(customQuestions[0]?.chapter || currentChapter);
  questions = customQuestions.slice();
  startExam(questions);
}

function startExamTimer() {
  const timer = document.getElementById('examTimer');
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const left = Math.max(0, 30 * 60 - elapsed);
    const minutes = Math.floor(left / 60);
    const seconds = left % 60;
    // 计时图标在 learn.html 里固定为 #examTimer 同级的时钟图标,这里只更新时间文本
    if (timer) timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (left === 0) finishExam();
  }, 1000);
}

function renderSingle(q, ans) {
  return `<div class="exam-options">${(q.options || []).map((opt) => {
    const label = opt.charAt(0);
    const text = opt.substring(2);
    return `<div class="exam-option ${ans === label ? 'selected' : ''}" data-action="exam-option" data-qid="${escapeHtml(q.id)}" data-value="${escapeHtml(label)}"><span class="exam-option-label">${escapeHtml(label)}.</span><span>${escapeHtml(text)}</span></div>`;
  }).join('')}</div>`;
}

function renderJudge(q, ans) {
  return `<div class="judge-options">
    <div class="judge-option ${ans === true ? 'selected' : ''}" data-action="exam-option" data-qid="${escapeHtml(q.id)}" data-value="true">${icon('check')} 正确</div>
    <div class="judge-option ${ans === false ? 'selected' : ''}" data-action="exam-option" data-qid="${escapeHtml(q.id)}" data-value="false">${icon('x')} 错误</div>
  </div>`;
}

function renderSort(q, ans) {
  const order = ans || q.items || [];
  return `<div class="sort-list">${order.map((item, idx) => `
    <div class="sort-item" draggable="true" data-action="sort-item" data-qid="${escapeHtml(q.id)}" data-index="${idx}">
      <span class="sort-handle">${icon('grip-vertical')}</span><span class="sort-num">${idx + 1}</span>${escapeHtml(item)}
    </div>
  `).join('')}</div>`;
}

function renderMatch(q, ans) {
  const state = ans || { selectedLeft: null, matches: {} };
  return `<div class="match-container">
    <div class="match-column"><div class="match-column-title">项目</div>${(q.left || []).map((item) => `<div class="match-item ${state.selectedLeft === item ? 'selected' : ''} ${state.matches[item] ? 'matched' : ''}" data-action="match-left" data-qid="${escapeHtml(q.id)}" data-value="${escapeHtml(item)}">${escapeHtml(item)}${state.matches[item] ? ` → ${escapeHtml(state.matches[item])}` : ''}</div>`).join('')}</div>
    <div class="match-column"><div class="match-column-title">说明</div>${(q.right || []).map((item) => `<div class="match-item" data-action="match-right" data-qid="${escapeHtml(q.id)}" data-value="${escapeHtml(item)}">${escapeHtml(item)}</div>`).join('')}</div>
  </div>`;
}

export function renderExamQuestion() {
  const q = questions[currentIdx];
  if (!q) return;
  const area = document.getElementById('examQuestionArea');
  const ans = answers[q.id];
  let body = '';
  if (q.type === 'single') body = renderSingle(q, ans);
  else if (q.type === 'judge') body = renderJudge(q, ans);
  else if (q.type === 'sort') body = renderSort(q, ans || q.items);
  else if (q.type === 'match') body = renderMatch(q, ans);
  else body = '<p>暂不支持的题型</p>';
  area.innerHTML = `<div class="question-card">
    <span class="question-type-badge ${escapeHtml(q.type)}">${escapeHtml(getTypeLabel(q.type))}</span>
    <div class="question-number">第 ${currentIdx + 1} 题</div>
    <div class="question-text">${escapeHtml(q.question || '')}</div>
    ${body}
  </div>`;
  document.getElementById('examCounter').textContent = `${currentIdx + 1}/${questions.length}`;
  document.getElementById('examProgressFill').style.width = `${((currentIdx + 1) / questions.length) * 100}%`;
  const buttons = document.querySelectorAll('.exam-nav button');
  if (buttons[0]) buttons[0].style.visibility = currentIdx === 0 ? 'hidden' : 'visible';
  if (buttons[2]) buttons[2].textContent = currentIdx === questions.length - 1 ? '提交试卷' : '下一题 →';
}

export function selectExamOption(qid, value) {
  const q = questions[currentIdx];
  answers[qid] = q.type === 'judge' ? value === 'true' : value;
  renderExamQuestion();
}

export function sortDragStart(target) {
  sortDragIdx = Number(target.dataset.index);
  target.classList.add('dragging');
}

export function sortDrop(target) {
  const q = questions[currentIdx];
  const dropIdx = Number(target.dataset.index);
  const current = (answers[q.id] || q.items || []).slice();
  if (sortDragIdx === null || sortDragIdx === dropIdx) return;
  const item = current.splice(sortDragIdx, 1)[0];
  current.splice(dropIdx, 0, item);
  answers[q.id] = current;
  sortDragIdx = null;
  renderExamQuestion();
}

export function selectMatchLeft(qid, item) {
  if (!answers[qid]) answers[qid] = { selectedLeft: null, matches: {} };
  if (answers[qid].matches[item]) {
    delete answers[qid].matches[item];
    answers[qid].selectedLeft = null;
  } else {
    answers[qid].selectedLeft = item;
  }
  renderExamQuestion();
}

export function selectMatchRight(qid, item) {
  if (!answers[qid]?.selectedLeft) return;
  const left = answers[qid].selectedLeft;
  const existing = Object.keys(answers[qid].matches).find((key) => answers[qid].matches[key] === item);
  if (existing) delete answers[qid].matches[existing];
  answers[qid].matches[left] = item;
  answers[qid].selectedLeft = null;
  renderExamQuestion();
}

export function prevExamQuestion() {
  if (currentIdx > 0) {
    currentIdx -= 1;
    renderExamQuestion();
  }
}

export function nextExamQuestion() {
  if (currentIdx < questions.length - 1) {
    currentIdx += 1;
    renderExamQuestion();
  } else {
    finishExam();
  }
}

export function formatAnswer(q, ans) {
  if (q.type === 'judge') return ans === true ? '正确' : ans === false ? '错误' : '未作答';
  if (!ans) return '未作答';
  if (q.type === 'single') return ans;
  if (q.type === 'sort') return ans.join(' → ');
  if (q.type === 'match') {
    const matches = ans.matches || ans;
    return Object.entries(matches).map(([left, right]) => `${left}→${right}`).join('; ') || '未作答';
  }
  return String(ans);
}

function isCorrect(q, ans) {
  if (q.type === 'single' || q.type === 'judge') return ans === q.answer;
  if (q.type === 'sort') return JSON.stringify(ans) === JSON.stringify(q.answer);
  if (q.type === 'match') {
    const matches = ans?.matches || {};
    const keys = Object.keys(q.answer || {});
    return Object.keys(matches).length === keys.length && keys.every((key) => matches[key] === q.answer[key]);
  }
  return false;
}

export function finishExam() {
  clearExamTimer();
  document.getElementById('examProgress').style.display = 'none';
  document.getElementById('examResult').style.display = 'block';
  const stats = { single: [0, 0], judge: [0, 0], sort: [0, 0], match: [0, 0] };
  const wrong = [];
  let correct = 0;
  questions.forEach((q, idx) => {
    const ans = answers[q.id];
    const ok = isCorrect(q, ans);
    if (stats[q.type]) {
      stats[q.type][1] += 1;
      if (ok) stats[q.type][0] += 1;
    }
    if (ok) {
      correct += 1;
      context.wrongbook.removeWrongQuestion(q.id);
    } else {
      const item = {
        id: q.id,
        type: q.type,
        chapter: q.chapter,
        question: q.question,
        options: q.options,
        answer: q.answer,
        correctAnswer: formatAnswer(q, q.answer),
        yourAnswer: formatAnswer(q, ans),
        explain: q.explain,
        items: q.items,
        left: q.left,
        right: q.right,
        examNum: idx + 1,
      };
      wrong.push(item);
      context.wrongbook.addWrongQuestion(item);
    }
  });
  const score = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById('resultScore').textContent = score;
  document.getElementById('resultScore').style.color = score >= 80 ? 'var(--cs)' : score >= 60 ? 'var(--cw)' : 'var(--cd)';
  document.getElementById('resultAccuracy').textContent = `${correct}/${questions.length}`;
  document.getElementById('resultTime').textContent = `${Math.floor(elapsed / 60)}分${elapsed % 60}秒`;
  document.getElementById('resultSingle').textContent = stats.single[1] ? `${stats.single[0]}/${stats.single[1]}` : '--';
  document.getElementById('resultJudge').textContent = stats.judge[1] ? `${stats.judge[0]}/${stats.judge[1]}` : '--';
  document.getElementById('resultSort').textContent = stats.sort[1] ? `${stats.sort[0]}/${stats.sort[1]}` : '--';
  document.getElementById('resultMatch').textContent = stats.match[1] ? `${stats.match[0]}/${stats.match[1]}` : '--';
  document.getElementById('resultWrongList').innerHTML = wrong.length
    ? `<h3 style="margin:24px 0 16px;">错题回顾</h3>${wrong.map((w) => `<div class="wrong-item" style="text-align:left;"><div class="wrong-meta">第 ${w.examNum} 题</div><div class="wrong-question">${escapeHtml(w.question)}</div>${renderAnswerDetail(w)}<div style="font-size:12px;color:var(--ctx2);margin-top:8px;">${icon('lightbulb')} ${escapeHtml(w.explain || '')}</div></div>`).join('')}`
    : `<div style="margin-top:24px;color:var(--correct-tx);font-size:18px;">${icon('party-popper')} 恭喜！全部答对！</div>`;
}

export function backToStudy() {
  clearExamTimer();
  document.getElementById('examView')?.classList.remove('active');
  context.setFooterMode('normal');
  context.navigateTo(context.getCurrentSection());
}

export function exitExam() {
  const resultVisible = document.getElementById('examResult')?.style.display === 'block';
  if (currentIdx > 0 && !resultVisible && !confirm('考试尚未完成，确定退出吗？')) return;
  clearExamTimer();
  document.getElementById('examView')?.classList.remove('active');
  context.setFooterMode('normal');
  context.navigateTo(context.getCurrentSection());
}

