#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const COURSE_ID = '2026-ic-manufacturing';
const COURSE_DIR = path.join(ROOT, 'courses', '2026-vocational-preliminary', COURSE_ID);

function visitBlocks(blocks, visit) {
  for (const block of blocks || []) {
    visit(block);
    if (block.type === 'tabSet') {
      for (const tab of block.tabs || []) visitBlocks(tab.blocks, visit);
    }
  }
}

test('generated theory text excludes non-visible Office list markers', () => {
  const content = JSON.parse(readFileSync(path.join(COURSE_DIR, 'content.json'), 'utf8'));
  const leaked = [];
  for (const [pointId, point] of Object.entries(content.knowledgePoints)) {
    visitBlocks(point.blocks, (block) => {
      if (block.type !== 'paragraph') return;
      const text = (block.spans || []).map((span) => span.t).join('');
      if (/<!\[(?:if|endif)/i.test(text)) leaked.push(`${pointId}: ${text}`);
    });
  }
  assert.deepEqual(leaked, []);
});

test('manufacturing source fidelity gate accepts decoded visible source text', () => {
  const verifier = path.join(ROOT, 'tools', 'autosmt-2026', 'scripts', 'verify-course-fidelity.mjs');
  const result = spawnSync(process.execPath, [verifier, COURSE_ID], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('captured MP4 resources keep a video extension in generated content', () => {
  const content = JSON.parse(readFileSync(path.join(COURSE_DIR, 'content.json'), 'utf8'));
  const videoSources = [];
  for (const point of Object.values(content.knowledgePoints)) {
    visitBlocks(point.blocks, (block) => {
      if (block.type === 'video') videoSources.push(block.src);
    });
  }
  assert.ok(videoSources.length > 0, 'manufacturing course must contain captured videos');
  assert.deepEqual(videoSources.filter((source) => !source.endsWith('.mp4')), []);
});

test('generated media directory contains no legacy endpoint suffixes', () => {
  const mediaDir = path.join(COURSE_DIR, 'assets', 'media');
  const invalid = readdirSync(mediaDir).filter((name) => !name.endsWith('.mp4'));
  assert.deepEqual(invalid, []);
});
