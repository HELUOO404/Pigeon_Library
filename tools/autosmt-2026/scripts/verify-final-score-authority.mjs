#!/usr/bin/env node
// Verifies that only final 2026 AutoSMT score evidence authorizes conversion.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const SECTIONS = path.join(REPORTS, 'source-capture', 'sections');
const CANDIDATE_SCORE_FILE = 'score-after-all-homework-candidates.json';
const HOMEWORK_REPAIR_EVIDENCE = {
  3: 'solve-work-3.json',
  13: 'solve-work-13.json',
  16: 'solve-work-16.json',
  17: 'solve-work-17.json',
  18: 'solve-work-18.json',
  19: 'solve-work-19.json',
};
const COURSE_RANGES = {
  manufacturing: { homework: range(1, 9), experiments: range(1, 19), projects: [1, 2], questions: 71 },
  devices: { homework: range(11, 19), experiments: range(22, 34), projects: [1, 2], questions: 85 },
  packaging: { homework: range(20, 29), experiments: range(35, 47), projects: [5, 6], questions: 101 },
};

const EXPERIMENT_EVIDENCE = {
  1: 'ui-state-experiment-1-after-v2.json',
  2: 'ui-state-experiment-2-after-completion.json',
  3: 'ui-state-experiment-3-after-v3.json',
  4: 'ui-state-experiment-4-strict-audit.json',
  5: 'ui-state-experiment-5-after-completion.json',
  6: 'ui-state-experiment-6-after-completion.json',
  7: 'ui-state-experiment-7-strict-audit.json',
  8: 'ui-state-experiment-8-after-v2.json',
  9: 'ui-state-experiment-9-strict-audit.json',
  10: 'ui-state-experiment-10-strict-audit.json',
  11: 'ui-state-experiment-11-after-v2.json',
  12: 'ui-state-experiment-12-after-completion.json',
  13: 'ui-state-experiment-13-after-v2.json',
  14: 'ui-state-experiment-14-strict-audit.json',
  15: 'ui-state-experiment-15-after-v2.json',
  16: 'ui-state-experiment-16-after-v2.json',
  17: 'ui-state-experiment-17-strict-audit.json',
  18: 'ui-state-experiment-18-strict-audit.json',
  19: 'ui-state-experiment-19-after-v2.json',
  22: 'ui-state-experiment-22-after-actions.json',
  23: 'ui-state-experiment-23-after-current-v1.json',
  24: 'ui-state-experiment-24-after-repair-v1.json',
  25: 'ui-state-experiment-25-after-row-repair-v1.json',
  26: 'ui-state-experiment-26-after-current-v1.json',
  27: 'ui-state-experiment-27-after-current-v1.json',
  28: 'ui-state-experiment-28-after-current-v1.json',
  29: 'ui-state-experiment-29-after-indexed-v1.json',
  30: 'ui-state-experiment-30-after-indexed-repair-v1.json',
  31: 'ui-state-experiment-31-after-indexed-v1.json',
  32: 'ui-state-experiment-32-after-v3.json',
  33: 'ui-state-experiment-33-strict-audit.json',
  34: 'ui-state-experiment-34-strict-audit.json',
  35: 'ui-state-experiment-35-strict-audit.json',
  36: 'ui-state-experiment-36-strict-audit.json',
  37: 'ui-state-experiment-37-strict-audit.json',
  38: 'ui-state-experiment-38-after-v3.json',
  39: 'ui-state-experiment-39-after-v2.json',
  40: 'ui-state-experiment-40-strict-audit.json',
  41: 'ui-state-experiment-41-strict-audit.json',
  42: 'ui-state-experiment-42-strict-audit.json',
  43: 'ui-state-experiment-43-strict-audit.json',
  44: 'ui-state-experiment-44-strict-audit.json',
  45: 'ui-state-experiment-45-strict-audit.json',
  46: 'ui-state-experiment-46-strict-audit.json',
  47: 'ui-state-experiment-47-strict-audit.json',
};
const PROJECT_EVIDENCE = {
  1: 'ui-state-engineering-1-strict-audit.json',
  2: 'ui-state-engineering-2-strict-audit.json',
  5: 'ui-state-engineering-5-strict-audit.json',
  6: 'ui-state-engineering-6-strict-audit.json',
};

function range(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(REPORTS, relative), 'utf8'));
}

function decodeSource(file) {
  const bytes = readFileSync(file);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

function asScores(finalScores, kind) {
  const scores = finalScores.scores || finalScores;
  const aliases = kind === 'projects' ? ['engineering', 'projects'] : [kind];
  for (const key of aliases) if (Array.isArray(scores[key])) return scores[key];
  return null;
}

function sameNumbers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function parseArgs(argv) {
  if (argv.length === 0) return null;
  if (argv.length === 2 && argv[0] === '--course' && COURSE_RANGES[argv[1]]) return argv[1];
  throw new Error('Usage: node verify-final-score-authority.mjs [--course manufacturing|devices|packaging]');
}

function homeworkEvidence() {
  const result = new Map();
  for (const entry of readdirSync(SECTIONS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SECTIONS, entry.name, 'homework.html');
    const html = decodeSource(file);
    const questionIds = [...html.matchAll(/<td>\s*(\d+)-(\d+)\s*<\/td>/g)];
    if (questionIds.length === 0) continue;
    const number = Number(questionIds[0][1]);
    if (questionIds.some((match) => Number(match[1]) !== number)) {
      throw new Error(`Mixed homework numbers in source-capture/sections/${entry.name}/homework.html`);
    }
    if (result.has(number)) throw new Error(`Duplicate source homework evidence for ${number}`);
    result.set(number, {
      sourceFile: `source-capture/sections/${entry.name}/homework.html`,
      questionCount: questionIds.length,
    });
  }
  return result;
}

function verifyFinalScores(finalScores, kind, numbers, failures) {
  const rows = asScores(finalScores, kind);
  if (!rows) {
    failures.push(`final-score-before-capture.json lacks ${kind} scores`);
    return [];
  }
  const byNumber = new Map(rows.map((row) => [Number(row.number), row]));
  return numbers.map((number) => {
    const row = byNumber.get(number);
    if (!row) failures.push(`final score missing ${kind}:${number}`);
    else if (row.score !== '100.00') failures.push(`final score is not 100.00 for ${kind}:${number}`);
    return { number, score: row?.score ?? null, name: row?.name ?? null };
  });
}

function verifyActivityEvidence(kind, numbers, evidenceMap, failures) {
  return numbers.map((number) => {
    const file = evidenceMap[number];
    if (!file) {
      failures.push(`No final evidence rule for ${kind}:${number}`);
      return { number, evidence: null, score: null };
    }
    let evidence;
    try {
      evidence = readJson(file);
    } catch (error) {
      failures.push(`Cannot read final evidence ${file}: ${error.message}`);
      return { number, evidence: file, score: null };
    }
    if (evidence.scoreType !== (kind === 'projects' ? 'engineering' : 'experiment') || Number(evidence.scoreNumber) !== number) {
      failures.push(`Ambiguous evidence identity in ${file}`);
    }
    if (evidence.score !== 100) failures.push(`Final evidence is not 100 for ${kind}:${number} (${file})`);
    return { number, evidence: file, score: evidence.score ?? null };
  });
}

let selectedCourse;
try {
  selectedCourse = parseArgs(process.argv.slice(2));
} catch (error) {
  console.log(JSON.stringify({ ok: false, failures: [error.message] }, null, 2));
  process.exit(1);
}

const selectedRanges = selectedCourse ? { [selectedCourse]: COURSE_RANGES[selectedCourse] } : COURSE_RANGES;
const expected = {
  homework: [...new Set(Object.values(selectedRanges).flatMap((course) => course.homework))].sort((a, b) => a - b),
  experiments: [...new Set(Object.values(selectedRanges).flatMap((course) => course.experiments))].sort((a, b) => a - b),
  projects: [...new Set(Object.values(selectedRanges).flatMap((course) => course.projects))].sort((a, b) => a - b),
};
const failures = [];
const scope = readJson('included-activity-scope.json');
const finalScores = readJson('final-score-before-capture.json');
const candidateScores = readJson(CANDIDATE_SCORE_FILE);
const candidates = readJson('candidate-answers.json');
const sourceHomework = homeworkEvidence();

for (const kind of Object.keys(expected)) {
  const scoped = scope.included?.[kind];
  const valid = selectedCourse
    ? Array.isArray(scoped) && expected[kind].every((number) => scoped.includes(number))
    : sameNumbers(scoped, expected[kind]);
  if (!valid) failures.push(`included-activity-scope.json ${kind} does not cover the selected 2026 range`);
}

const homework = expected.homework.map((number) => {
  const source = sourceHomework.get(number);
  const repairFile = HOMEWORK_REPAIR_EVIDENCE[number] || null;
  const repair = repairFile ? readJson(repairFile) : null;
  const candidate = repair?.answers ?? candidates[number];
  if (!source) {
    failures.push(`Source homework evidence missing for ${number}`);
    return { number, sourceFile: null, questionCount: null, candidateCount: Array.isArray(candidate) ? candidate.length : null };
  }
  if (repair) {
    if (Number(repair.work) !== number || Number(repair.score) !== 100) {
      failures.push(`Repair evidence is not an unambiguous 100-point result for homework:${number}`);
    }
  } else {
    const submissionScore = asScores(candidateScores, 'homework')?.find((row) => Number(row.number) === number)?.score;
    if (submissionScore !== '100.00') failures.push(`Candidate submission score is not 100.00 for homework:${number}`);
  }
  if (!Array.isArray(candidate)) failures.push(`Candidate answers missing for homework:${number}`);
  else if (candidate.length !== source.questionCount) {
    failures.push(`Answer count mismatch for homework:${number}`);
  } else if (candidate.some((answer) => !/^[A-Z]$/.test(answer))) {
    failures.push(`Candidate answers contain an invalid option key for homework:${number}`);
  }
  return {
    number,
    sourceFile: source.sourceFile,
    questionCount: source.questionCount,
    candidateCount: Array.isArray(candidate) ? candidate.length : null,
    answerSourceFile: repairFile || 'candidate-answers.json',
    answerSourceLocation: repairFile ? '/answers' : `/${number}`,
    answerEvidenceScore: repair ? repair.score : '100.00',
  };
});

const finalScore = {
  homework: verifyFinalScores(finalScores, 'homework', expected.homework, failures),
  experiments: verifyFinalScores(finalScores, 'experiment', expected.experiments, failures),
  projects: verifyFinalScores(finalScores, 'projects', expected.projects, failures),
};
const activityEvidence = {
  experiments: verifyActivityEvidence('experiments', expected.experiments, EXPERIMENT_EVIDENCE, failures),
  projects: verifyActivityEvidence('projects', expected.projects, PROJECT_EVIDENCE, failures),
};
const questions = homework.reduce((sum, item) => sum + (item.questionCount || 0), 0);
const expectedQuestions = selectedCourse ? COURSE_RANGES[selectedCourse].questions : 257;
if (questions !== expectedQuestions) failures.push(`Question count is ${questions}, expected ${expectedQuestions}`);

console.log(JSON.stringify({
  ok: failures.length === 0,
  course: selectedCourse || 'all',
  answerAuthority: 'full-score-audit',
  candidateAnswerFile: 'candidate-answers.json',
  candidateSubmissionScoreFile: CANDIDATE_SCORE_FILE,
  finalScoreFile: 'final-score-before-capture.json',
  expected: { ...expected, questionCount: expectedQuestions },
  actualQuestionCount: questions,
  homework,
  repairEvidence: Object.fromEntries(
    Object.entries(HOMEWORK_REPAIR_EVIDENCE)
      .filter(([number]) => expected.homework.includes(Number(number))),
  ),
  finalScore,
  activityEvidence,
  finalRepairEvidence: {
    24: EXPERIMENT_EVIDENCE[24],
    25: EXPERIMENT_EVIDENCE[25],
    30: EXPERIMENT_EVIDENCE[30],
    38: EXPERIMENT_EVIDENCE[38],
  },
  failures,
}, null, 2));
process.exit(failures.length === 0 ? 0 : 1);
