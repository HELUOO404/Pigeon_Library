import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertEngineeringParams } from '../lib/engineering-param-converter.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const ACTIVITIES = path.join(REPORTS, 'activity-details');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const simulationCapture = readJson(path.join(REPORTS, 'engineering-simulation-capture-v1.json')).steps;
const staticCapture = readJson(path.join(REPORTS, 'resource-capture-static-v1.json')).captured;

const expected = [
  { scoreNumber: 1, sourceFile: '1-2-engineering-1-tab-0.html', evidenceFile: 'ui-state-engineering-1-strict-audit.json', selectCount: 177, simulationCount: 20 },
  { scoreNumber: 2, sourceFile: '1-4-engineering-2-tab-0.html', evidenceFile: 'ui-state-engineering-2-strict-audit.json', selectCount: 65, staticRowCount: 91, simulationCount: 9 },
  { scoreNumber: 5, sourceFile: '4-1-engineering-5-tab-0.html', evidenceFile: 'ui-state-engineering-5-strict-audit.json', selectCount: 46 },
  { scoreNumber: 6, sourceFile: '4-3-engineering-6-tab-0.html', evidenceFile: 'ui-state-engineering-6-strict-audit.json', selectCount: 67, simulationCount: 2 },
];

for (const expectation of expected) {
  const activity = readJson(path.join(ACTIVITIES, expectation.sourceFile.replace('.html', '.json')));
  const result = convertEngineeringParams({
    activity,
    html: readFileSync(path.join(ACTIVITIES, expectation.sourceFile), 'utf8'),
    evidence: readJson(path.join(REPORTS, expectation.evidenceFile)),
    simulationCapture,
    staticCapture,
    sourceFile: expectation.sourceFile,
    evidenceFile: expectation.evidenceFile,
    simulationEvidenceFile: 'engineering-simulation-capture-v1.json',
    staticEvidenceFile: 'resource-capture-static-v1.json',
    resolveImage(captured) {
      return `assets/images/${captured.sha256}.${captured.file.split('.').pop()}`;
    },
  });

  assert.equal(result.id, `engineering-${expectation.scoreNumber}-0-params`);
  const paramSelect = result.blocks.find((block) => block.type === 'paramSelect');
  assert.ok(paramSelect, `engineering ${expectation.scoreNumber} exposes answerable parameters`);
  const parameters = paramSelect.groups.flatMap((group) => group.params);
  const fullScoreValues = readJson(path.join(REPORTS, expectation.evidenceFile)).tabs[0].selectedValues;
  assert.equal(parameters.length, expectation.selectCount);
  assert.ok(parameters.every((param) => param.options.length && Number.isInteger(param.answerIndex) && param.answerIndex > 0));
  assert.deepEqual(parameters.map((param) => param.options[param.answerIndex - 1]), fullScoreValues, 'every answerIndex resolves to the verified full-score value');
  if (expectation.simulationCount) {
    assert.equal(paramSelect.simulations.length, expectation.simulationCount);
    assert.ok(paramSelect.simulations.every((item) => item.images.length && item.paramRange[0] <= item.paramRange[1]));
    assert.ok(paramSelect.simulations.every((item) => item.paramRange[1] <= expectation.selectCount));
  } else {
    assert.deepEqual(paramSelect.simulations, []);
  }
  if (expectation.staticRowCount) {
    const table = result.blocks.find((block) => block.type === 'paramsTable');
    assert.ok(table, 'fixed values remain a native table');
    assert.equal(table.rows.length, expectation.staticRowCount);
  }
  if (expectation.scoreNumber === 5) {
    assert.ok(paramSelect.groups.some((group) => group.merged.some((cell) => typeof cell === 'object' && Array.isArray(cell.images) && cell.images.length)), 'engineering 5 retains diagram and equipment images');
  }
  assert.ok(result.sourceLedger.length > 0);
  assert.ok(result.sourceLedger.every((entry) => entry.target && entry.sourceFile && entry.sourceLocation));
  assert.ok(result.sourceLedger.some((entry) => entry.kind === 'parameter-answer' && entry.sourceFile === expectation.evidenceFile));
  assert.equal(result.audit.goldReference.presentation, 'autosmt-oxidation-golden');
  assert.equal(result.audit.goldReference.structure, 'ic-packaging.pigeon');
}

const first = expected[0];
const invalidEvidence = readJson(path.join(REPORTS, first.evidenceFile));
invalidEvidence.score = 99;
assert.throws(() => convertEngineeringParams({
  activity: readJson(path.join(ACTIVITIES, first.sourceFile.replace('.html', '.json'))),
  html: readFileSync(path.join(ACTIVITIES, first.sourceFile), 'utf8'),
  evidence: invalidEvidence,
  simulationCapture,
  staticCapture,
  sourceFile: first.sourceFile,
  evidenceFile: 'invalid.json',
  simulationEvidenceFile: 'engineering-simulation-capture-v1.json',
  staticEvidenceFile: 'resource-capture-static-v1.json',
  resolveImage: (captured) => `assets/images/${captured.sha256}.${captured.file.split('.').pop()}`,
}), /no full-score evidence/);

console.log('engineering-param-converter: ok');
