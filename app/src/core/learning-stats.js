const SLOTS = ['progress', 'quiz', 'wrong', 'studyTime', 'exams'];

function round(value) {
  return Math.round(value);
}

function emptyTotals() {
  return { courses: 0, doneQuestions: 0, correctQuestions: 0, accuracy: null, mastered: 0, studyMs: 0,
    wrongCount: 0, quizQuestions: 0, examQuestions: 0, examCount: 0, examAvgScore: null,
    examBestScore: null, examScores: [] };
}

function safeJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parsed(key) {
  const raw = localStorage.getItem(key);
  if (raw == null) return null;
  return safeJson(raw, null);
}

function maxTime(values) {
  return values.reduce((max, value) => Math.max(max, numberValue(value && value.t)), 0);
}

export function collectLearningStats({ uid, titles } = {}) {
  const totals = emptyTotals();
  if (uid == null || typeof localStorage === 'undefined') {
    return { totals, perCourse: [], exams: [] };
  }

  const prefix = 'pglib:u:' + uid + ':';
  const found = new Map();

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(prefix)) continue;

    const rest = key.slice(prefix.length);
    if (rest === '__meta') continue;

    const slotAt = rest.lastIndexOf(':');
    if (slotAt < 1) continue;

    const courseKey = rest.slice(0, slotAt);
    const slot = rest.slice(slotAt + 1);
    if (courseKey === '__global__' || !SLOTS.includes(slot)) continue;
    if (!found.has(courseKey)) found.set(courseKey, {});
    found.get(courseKey)[slot] = key;
  }

  const titleMap = objectValue(titles);
  const perCourse = [];
  const exams = [];
  const examScores = [];

  for (const [courseKey, keys] of found) {
    const meta = objectValue(titleMap[courseKey]);
    const title = typeof meta.title === 'string' && meta.title ? meta.title : courseKey;
    const total = typeof meta.total === 'number' && Number.isFinite(meta.total) ? meta.total : null;
    const progress = objectValue(parsed(keys.progress));
    const quiz = objectValue(parsed(keys.quiz));
    const wrong = arrayValue(parsed(keys.wrong));
    const studyMs = numberValue(parsed(keys.studyTime));
    const courseExams = arrayValue(parsed(keys.exams));

    const mastered = Object.values(progress).filter((value) => value === 'mastered').length;
    const quizItems = Object.values(quiz);
    const quizQuestions = Object.keys(quiz).length;
    const quizCorrect = quizItems.filter((item) => item && item.correct === true).length;
    const examCount = courseExams.length;
    const examQuestions = courseExams.reduce((sum, exam) => sum + numberValue(exam && exam.total), 0);
    const examCorrect = courseExams.reduce((sum, exam) => sum + numberValue(exam && exam.correct), 0);
    const scores = courseExams
      .map((exam) => numberValue(exam && exam.score))
      .filter((score) => Number.isFinite(score));
    const bestScore = scores.length ? Math.max(...scores) : null;
    const avgScore = scores.length ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const doneQuestions = quizQuestions + examQuestions;
    const correctQuestions = quizCorrect + examCorrect;
    const accuracy = doneQuestions ? round((correctQuestions / doneQuestions) * 100) : null;
    const lastActivity = Math.max(maxTime(quizItems), maxTime(courseExams));

    for (const exam of courseExams) {
      const record = { courseKey, title, chapter: exam && exam.chapter, score: numberValue(exam && exam.score),
        total: numberValue(exam && exam.total), correct: numberValue(exam && exam.correct),
        t: numberValue(exam && exam.t) };
      exams.push(record);
      examScores.push({ score: record.score, t: record.t });
    }

    perCourse.push({ courseKey, title, mastered, total, progressPct: total ? round((mastered / total) * 100) : null,
      quizQuestions, quizCorrect, examCount, examQuestions, examCorrect, bestScore, avgScore, studyMs,
      wrongCount: wrong.length, doneQuestions, correctQuestions, accuracy, lastActivity });

    const hasActivity = quizQuestions > 0 || examCount > 0 || Object.keys(progress).length > 0 || studyMs > 0;
    if (hasActivity) totals.courses += 1;
    totals.doneQuestions += doneQuestions;
    totals.correctQuestions += correctQuestions;
    totals.mastered += mastered;
    totals.studyMs += studyMs;
    totals.wrongCount += wrong.length;
    totals.quizQuestions += quizQuestions;
    totals.examQuestions += examQuestions;
    totals.examCount += examCount;
  }

  const sortedScores = examScores.sort((a, b) => a.t - b.t).map((item) => item.score);
  totals.accuracy = totals.doneQuestions ? round((totals.correctQuestions / totals.doneQuestions) * 100) : null;
  totals.examAvgScore = sortedScores.length
    ? round(sortedScores.reduce((sum, score) => sum + score, 0) / sortedScores.length)
    : null;
  totals.examBestScore = sortedScores.length ? Math.max(...sortedScores) : null;
  totals.examScores = sortedScores;

  perCourse.sort((a, b) => b.lastActivity - a.lastActivity);
  exams.sort((a, b) => a.t - b.t);
  return { totals, perCourse, exams };
}
