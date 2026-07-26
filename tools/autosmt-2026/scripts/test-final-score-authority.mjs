#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const rebuildScript = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs');
const finalScoreFile = 'final-score-before-capture.json';
const supersededCandidateFile = 'score-after-all-homework-candidates.json';

function homeworkScore(file, number) {
  return JSON.parse(readFileSync(file, 'utf8')).scores.homework.find((entry) => entry.number === number)?.score;
}

function authorityCommand(...args) {
  return spawnSync(process.execPath, [rebuildScript, ...args], { encoding: 'utf8' });
}

function finalAuthority(scoreType, scoreNumber) {
  const result = authorityCommand('--score-authority', scoreType, String(scoreNumber));
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('rebuild uses the final full-score record as its sole homework-score authority', () => {
  const source = readFileSync(rebuildScript, 'utf8');
  const finalReferences = source.match(/final-score-before-capture\.json/g) || [];

  assert.equal(finalReferences.length, 1, 'the authority path must be declared once and reused');
  assert.match(source, /const FINAL_SCORE_EVIDENCE = path\.join\(REPORTS, 'final-score-before-capture\.json'\);/);
  assert.match(source, /const scoreEvidence = readJson\(FINAL_SCORE_EVIDENCE\);/);
  assert.match(source, /repoPath\(FINAL_SCORE_EVIDENCE\)/);
  assert.match(source, /sha256File\(FINAL_SCORE_EVIDENCE\)/);
  assert.match(source, /function finalFullScoreEvidence\(scoreType, scoreNumber\)/);
  assert.equal(source.includes('`/scores/homework/${homeworkId}`'), false, 'homework number must not be mistaken for its final-score array index');
  assert.equal(source.includes(supersededCandidateFile), false, 'superseded candidate-stage scores must not be referenced');
});

test('the exact-string full-score gate accepts homework 13 from the final record only', () => {
  assert.equal(homeworkScore(path.join(REPORTS, finalScoreFile), 13), '100.00');
  assert.notEqual(homeworkScore(path.join(REPORTS, supersededCandidateFile), 13), '100.00');
});

test('final-score helper resolves the actual score array index for each score kind', () => {
  assert.deepEqual(finalAuthority('homework', 13), {
    sourceFile: 'tools/autosmt-2026/reports/final-score-before-capture.json',
    sourceLocation: '/scores/homework/12',
    sourceSha256: finalAuthority('homework', 13).sourceSha256,
    scoreType: 'homework',
    scoreNumber: 13,
    observedScore: '100.00',
  });
  assert.equal(finalAuthority('experiment', 22).sourceLocation, '/scores/experiment/21');
  assert.equal(finalAuthority('engineering', 2).sourceLocation, '/scores/engineering/1');
  assert.equal(finalAuthority('project', 2).scoreType, 'engineering', 'engineering aliases must resolve through the actual final-score collection');
});

test('final-score helper hard-stops for records that are not exactly 100.00', () => {
  for (const [scoreType, scoreNumber] of [['homework', 10], ['experiment', 20], ['engineering', 3]]) {
    const result = authorityCommand('--score-authority', scoreType, String(scoreNumber));
    assert.notEqual(result.status, 0, `${scoreType} ${scoreNumber} must fail`);
    assert.match(result.stderr, /\[HARD STOP\].*not exactly 100\.00/s);
  }
});

test('interactive authority evidence contains both the selected UI-state and final-score record', () => {
  const result = authorityCommand('--authority-evidence', 'experiment', '22', 'ui-state-experiment-22-after-actions.json', '0');
  assert.equal(result.status, 0, result.stderr);
  const records = JSON.parse(result.stdout);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => ({ scoreType: record.scoreType, scoreNumber: record.scoreNumber, observedScore: record.observedScore })), [
    { scoreType: 'experiment', scoreNumber: 22, observedScore: 100 },
    { scoreType: 'experiment', scoreNumber: 22, observedScore: '100.00' },
  ]);
  assert.equal(records[0].sourceFile, 'tools/autosmt-2026/reports/ui-state-experiment-22-after-actions.json');
  assert.equal(records[1].sourceFile, 'tools/autosmt-2026/reports/final-score-before-capture.json');
  assert.equal(records[1].sourceLocation, '/scores/experiment/21');
});
