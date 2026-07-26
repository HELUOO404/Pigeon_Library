import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFlatProcess } from '../lib/flat-process-converter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const ACTIVITIES = path.join(REPORTS, 'activity-details');
const CAPTURE = path.join(REPORTS, 'source-capture');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const processVideos = readJson(path.join(REPORTS, 'process-step-video-capture-v1.json')).steps;

const activities = [
  [42, '4-1', 'verify-candidate-experiment-42.json'],
  [43, '4-1', 'verify-candidate-experiment-43.json'],
  [44, '4-2', 'verify-candidate-experiment-44-v3.json'],
  [45, '4-2', 'verify-candidate-experiment-45.json'],
  [46, '4-3', 'verify-candidate-experiment-46.json'],
  [47, '4-4', 'verify-candidate-experiment-47.json'],
];

for (const [scoreNumber, section, evidenceName] of activities) {
  const sourceName = `${section}-experiment-${scoreNumber}-tab-0.html`;
  const activity = readJson(path.join(ACTIVITIES, sourceName.replace('.html', '.json')));
  const html = readFileSync(path.join(ACTIVITIES, sourceName), 'utf8');
  const result = convertFlatProcess({
    activity,
    html,
    evidence: readJson(path.join(REPORTS, evidenceName)),
    stepVideos: processVideos,
    sourceFile: sourceName,
    evidenceFile: evidenceName,
    videoEvidenceFile: 'process-step-video-capture-v1.json',
    resolveClip(entry) {
      const captured = path.join(CAPTURE, entry.file);
      assert.ok(existsSync(captured), `${scoreNumber}: captured clip exists`);
      const bytes = readFileSync(captured);
      assert.equal(bytes.length, entry.bytes, `${scoreNumber}: captured byte count`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${scoreNumber}: captured hash`);
      return `assets/media/${entry.sha256}.mp4`;
    },
  });
  const simulation = result.blocks[2];
  assert.equal(result.id, `experiment-${scoreNumber}-0-process`);
  assert.equal(result.blocks[0].type, 'heading');
  assert.equal(result.blocks[1].type, 'paragraph');
  assert.equal(simulation.type, 'stepSimulation');
  assert.equal(simulation.steps.length, activity.selectCount);
  assert.equal(result.audit.stepCount, activity.selectCount);
  assert.equal(result.audit.poster, null);
  assert.match(result.audit.posterSource, /^none:/);
  for (const [index, step] of simulation.steps.entries()) {
    assert.equal(step.prompt, `工序${index + 1}`);
    assert.equal(step.options.length, simulation.steps.length);
    assert.ok(step.answerIndex >= 1 && step.answerIndex <= step.options.length);
    assert.equal(step.options[step.answerIndex - 1], readJson(path.join(REPORTS, evidenceName)).submittedTabs[0].selected[index].value);
    assert.match(step.clip, /^assets\/media\/[a-f0-9]{64}\.mp4$/);
  }
  assert.equal(result.sourceLedger.length, 2 + simulation.steps.length * 4);
  assert.ok(result.sourceLedger.every((entry) => entry.sourceFile && entry.sourceLocation));
  assert.ok(result.sourceLedger.some((entry) => entry.kind === 'process-answer' && entry.sourceFile === evidenceName));
}

const sourceName = '4-1-experiment-42-tab-0.html';
const activity = readJson(path.join(ACTIVITIES, sourceName.replace('.html', '.json')));
const html = readFileSync(path.join(ACTIVITIES, sourceName), 'utf8');
const badEvidence = readJson(path.join(REPORTS, 'verify-candidate-experiment-42.json'));
badEvidence.finalScore = 99;
assert.throws(() => convertFlatProcess({
  activity,
  html,
  evidence: badEvidence,
  stepVideos: processVideos,
  sourceFile: sourceName,
  evidenceFile: 'bad.json',
  videoEvidenceFile: 'process-step-video-capture-v1.json',
  resolveClip: () => 'assets/media/x.mp4',
}), /verified full-score evidence/);

console.log('flat-process-converter: ok');
