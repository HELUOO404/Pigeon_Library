// wrongbook.js — 错题本:增删、按章筛选、渲染、重做(单题/全部);按题库 id 去重存储。
import { icon } from '../core/icons.js';
import { escapeHtml } from './utils.js';

let storeRef;
let examStarter;
let closePanelRef;

export function initWrongbook({ store, startExam, closePanel }) {
  storeRef = store;
  examStarter = startExam;
  closePanelRef = closePanel;
}

export function getWrongQuestions() {
  return storeRef.get('wrong', []);
}

export function addWrongQuestion(question) {
  if (!question || !question.id) return;
  const wrong = getWrongQuestions();
  const idx = wrong.findIndex((item) => item.id === question.id);
  const next = { ...question, date: new Date().toISOString() };
  if (idx >= 0) wrong[idx] = next;
  else wrong.push(next);
  storeRef.set('wrong', wrong);
}

export function removeWrongQuestion(id) {
  storeRef.set('wrong', getWrongQuestions().filter((item) => item.id !== id));
  renderWrongList();
}

function typeLabel(type) {
  return { single: '单选题', judge: '判断题', sort: '排序题', match: '匹配题' }[type] || type || '题目';
}

function answerLine(w) {
  return `<div class="wrong-answer">你的答案：<span class="user">${escapeHtml(w.yourAnswer || '未作答')}</span></div><div class="wrong-answer">正确答案：<span class="correct">${escapeHtml(w.correctAnswer || '')}</span></div>`;
}

function singleOptions(w) {
  if (!Array.isArray(w.options) || !w.options.length) return answerLine(w);
  return `<div class="result-options-list">${w.options.map((opt) => {
    const label = opt.charAt(0);
    const text = opt.substring(2);
    const correct = label === w.correctAnswer;
    const wrong = label === w.yourAnswer && !correct;
    const cls = correct ? 'correct' : wrong ? 'wrong' : '';
    const mark = correct ? icon('check') : wrong ? icon('x') : '';
    const tag = correct ? '<span class="answer-tag">← 正确答案</span>' : wrong ? '<span class="answer-tag">← 你的答案</span>' : '';
    return `<div class="result-option ${cls}"><span class="result-option-label">${mark} ${escapeHtml(label)}.</span><span class="result-option-text">${escapeHtml(text)}</span>${tag}</div>`;
  }).join('')}</div>`;
}

// 错题答案详情:单选→列出全部选项并标"对/错";其它题型→你的/正确答案行。错题本与考试结果共用。
export function renderAnswerDetail(w) {
  return w.type === 'single' ? singleOptions(w) : answerLine(w);
}

export function renderWrongList(filterChapter = 'all') {
  const container = document.getElementById('wrongList');
  if (!container) return;
  const wrong = getWrongQuestions();
  const filtered = filterChapter && filterChapter !== 'all'
    ? wrong.filter((item) => item.chapter === filterChapter)
    : wrong;
  if (!filtered.length) {
    container.innerHTML = `<p style="text-align:center;color:var(--ctx2);padding:20px;">${filterChapter && filterChapter !== 'all' ? '该章节暂无错题' : '暂无错题记录，继续加油！'}</p>`;
    return;
  }
  container.innerHTML = filtered.map((w, idx) => `
    <div class="wrong-item">
      <div class="wrong-meta">第${escapeHtml(w.chapter || '?')}章 | ${escapeHtml(typeLabel(w.type))} | ${escapeHtml(new Date(w.date || Date.now()).toLocaleDateString())}</div>
      <div class="wrong-question">${idx + 1}. ${escapeHtml(w.question || '')}</div>
      ${renderAnswerDetail(w)}
      <div style="font-size:12px;color:var(--ctx2);margin-top:8px;">${icon('lightbulb')} ${escapeHtml(w.explain || '暂无解析')}</div>
      <div class="wrong-actions">
        <button data-action="remove-wrong" data-id="${escapeHtml(w.id)}">${icon('check')} 已掌握，移除</button>
        <button data-action="redo-wrong" data-id="${escapeHtml(w.id)}">${icon('rotate-ccw')} 重新练习</button>
      </div>
    </div>
  `).join('');
}

export function filterWrong(chapter) {
  renderWrongList(chapter);
}

export function redoAllWrong() {
  const wrong = getWrongQuestions();
  if (!wrong.length) {
    alert('暂无错题需要练习');
    return;
  }
  closePanelRef?.();
  examStarter(wrong.map(toExamQuestion), { fromWrongbook: true });
}

export function redoWrong(id) {
  const wrong = getWrongQuestions().find((item) => item.id === id);
  if (wrong) {
    closePanelRef?.();
    examStarter([toExamQuestion(wrong)], { fromWrongbook: true });
  }
}

function toExamQuestion(w) {
  return {
    id: w.id,
    type: w.type,
    chapter: w.chapter,
    question: w.question,
    options: w.options,
    answer: w.answer,
    explain: w.explain,
    items: w.items,
    left: w.left,
    right: w.right,
  };
}
