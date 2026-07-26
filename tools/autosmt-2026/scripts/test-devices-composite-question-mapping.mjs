#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const rebuildScript = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'rebuild-vocational-course.mjs');
const mappingFile = path.join(
  ROOT,
  'courses',
  '2026-vocational-preliminary',
  '2026-ic-devices',
  'question-knowledge-map.json',
);
const contentFile = path.join(
  ROOT,
  'courses',
  '2026-vocational-preliminary',
  '2026-ic-devices',
  'content.json',
);

function nestedBlocks(blocks) {
  return blocks.flatMap((block) => [
    block,
    ...(block.type === 'tabSet' ? block.tabs.flatMap((tab) => nestedBlocks(tab.blocks)) : []),
  ]);
}

test('devices question 14-7 is recorded as a section synthesis after both related theory cards', () => {
  const result = spawnSync(process.execPath, [rebuildScript, 'devices'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const mapping = JSON.parse(readFileSync(mappingFile, 'utf8'));
  const entry = mapping.entries.find((candidate) => candidate.sourceQuestionId === '14-7');
  assert.ok(entry, '14-7 mapping must exist');
  assert.equal(entry.targetKnowledgePoint, '2-4-2');
  assert.deepEqual(entry.mappingOverride, {
    kind: 'section-synthesis',
    targetTopic: 'NMOS触发器工艺流程',
    relatedTopics: ['CMOS非门工艺流程', 'NMOS触发器工艺流程'],
    placement: 'after-related-section-theory',
    manualUserDecision: 'continue-until-all-courses-delivered',
  });
  assert.match(entry.matchReason, /小节综合题/);

  const manualPlacements = new Map([
    ['12-2', ['2-2-1', 'manual-anchor']],
    ['12-3', ['2-2-1', 'manual-anchor']],
    ['17-12', ['2-7-3', 'manual-section-placement']],
    ['17-14', ['2-7-3', 'manual-section-placement']],
    ['19-6', ['3-2-1', 'manual-anchor']],
  ]);
  for (const [sourceQuestionId, [targetKnowledgePoint, kind]] of manualPlacements) {
    const manual = mapping.entries.find((candidate) => candidate.sourceQuestionId === sourceQuestionId);
    assert.ok(manual, `${sourceQuestionId} mapping must exist`);
    assert.equal(manual.targetKnowledgePoint, targetKnowledgePoint);
    assert.equal(manual.mappingOverride.kind, kind);
    assert.equal(manual.mappingOverride.manualUserDecision, 'batch-handle-similar-issues');
    assert.match(manual.matchReason, /人工编排/);
  }

  const content = JSON.parse(readFileSync(contentFile, 'utf8'));
  const blocks = Object.values(content.knowledgePoints).flatMap((point) => nestedBlocks(point.blocks));
  const layout = blocks.find((block) => block.type === 'sandbox' && block.id === 'drawing-33-0');
  assert.ok(layout, 'drawing-33-0 sandbox must exist');
  assert.equal((layout.html.match(/data-drawing-mark-token=/g) || []).length, 6);
  assert.doesNotMatch(layout.html, /RGB\(|background-color/i);
  const pnVi = blocks.find((block) => block.type === 'sandbox' && block.id === 'drawing-22-2');
  assert.ok(pnVi, 'drawing-22-2 sandbox must exist');
  assert.equal((pnVi.html.match(/data-control-index=/g) || []).length, 12);
  assert.match(pnVi.html, /25/);
  assert.match(pnVi.html, /100/);
  assert.match(pnVi.html, /Ib\(uA\)/);
});
