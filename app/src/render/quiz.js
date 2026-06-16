import { getCleanText } from './utils.js';

let quizRef;
let storeRef;
let wrongbook;

export function initQuiz({ quiz, store, wrong }) {
  quizRef = quiz;
  storeRef = store;
  wrongbook = wrong;
}

function questionById(qid) {
  for (const questions of Object.values(quizRef.sectionQuizzes || {})) {
    const found = questions.find((q) => q.qid === qid);
    if (found) return found;
  }
  return null;
}

export function selectOpt(label) {
  label.parentElement.querySelectorAll('.quiz-opt').forEach((opt) => opt.classList.remove('selected'));
  label.classList.add('selected');
}

export function submitQuiz(qid) {
  const q = questionById(qid);
  const fb = document.getElementById(`fb-${qid}`);
  if (!q || !fb) return;
  const selected = document.querySelector(`input[name="${CSS.escape(qid)}"]:checked`);
  if (!selected) {
    fb.className = 'quiz-fb show wrong';
    fb.textContent = '请先选择答案';
    return;
  }
  const correct = selected.value === q.ans;
  fb.className = `quiz-fb show ${correct ? 'correct' : 'wrong'}`;
  fb.textContent = correct ? `✓ 正确！${q.exp || ''}` : `✗ 错误。正确答案：${q.ans}。${q.exp || ''}`;
  const item = selected.closest('.quiz-item');
  item?.querySelectorAll('.quiz-opt').forEach((opt) => opt.classList.remove('correct', 'wrong'));
  selected.closest('.quiz-opt')?.classList.add(correct ? 'correct' : 'wrong');

  const results = storeRef.get('quiz', {});
  results[qid] = { ans: selected.value, correct, t: Date.now() };
  storeRef.set('quiz', results);

  if (!correct && item) {
    const card = item.closest('.knowledge-card');
    const kpId = card?.id.replace('kp-', '') || '';
    const options = Array.from(item.querySelectorAll('.quiz-opt span')).map((el) => getCleanText(el));
    wrongbook.addWrongQuestion({
      id: `quiz-${qid}`,
      type: 'single',
      chapter: kpId.split('-')[0],
      question: getCleanText(item.querySelector('.quiz-q')),
      options,
      answer: q.ans,
      correctAnswer: q.ans,
      yourAnswer: selected.value,
      explain: q.exp || '',
    });
  }
}

export function restoreQuizResults() {
  const results = storeRef.get('quiz', {});
  Object.entries(results).forEach(([qid, result]) => {
    const q = questionById(qid);
    const fb = document.getElementById(`fb-${qid}`);
    if (!q || !fb) return;
    document.querySelectorAll(`input[name="${CSS.escape(qid)}"]`).forEach((input) => {
      const label = input.closest('.quiz-opt');
      if (input.value === result.ans) {
        input.checked = true;
        label?.classList.add(result.correct ? 'correct' : 'wrong');
      }
    });
    fb.className = `quiz-fb show ${result.correct ? 'correct' : 'wrong'}`;
    fb.textContent = result.correct ? `✓ 已正确回答 💡 ${q.exp || ''}` : `✗ 错误。上次答案：${result.ans} 💡 ${q.exp || ''}`;
  });
}

