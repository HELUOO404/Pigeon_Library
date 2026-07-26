#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const content = JSON.parse(readFileSync(path.join(
  ROOT,
  'courses',
  '2026-vocational-preliminary',
  '2026-ic-manufacturing',
  'content.json',
), 'utf8'));

function collectSandboxes(blocks, output = []) {
  for (const block of blocks || []) {
    if (block.type === 'sandbox') output.push(block);
    if (block.type === 'tabSet') {
      for (const tab of block.tabs || []) collectSandboxes(tab.blocks, output);
    }
  }
  return output;
}

function collectDrawingTabs(blocks, output = new Map()) {
  for (const block of blocks || []) {
    if (block.type !== 'tabSet') continue;
    for (const tab of block.tabs || []) {
      const sandbox = (tab.blocks || []).find((candidate) => candidate.type === 'sandbox' && candidate.id?.startsWith('drawing-'));
      if (sandbox) output.set(sandbox.id, tab.blocks);
      collectDrawingTabs(tab.blocks, output);
    }
  }
  return output;
}

const sandboxes = Object.values(content.knowledgePoints)
  .flatMap((point) => collectSandboxes(point.blocks))
  .filter((block) => block.id?.startsWith('drawing-'));
const drawingTabs = Object.values(content.knowledgePoints)
  .reduce((output, point) => collectDrawingTabs(point.blocks, output), new Map());

const expected = {
  'drawing-3-2': { controls: 4, text: ['PECVD温度曲线参数设置及仿真', '炉子加热阶段', '杂质气流量:400ml/min'] },
  'drawing-7-1': { controls: 10, text: ['外延温度曲线参数设置及仿真', '温度曲线仿真'] },
  'drawing-15-1': { controls: 5, text: ['硼扩散温度曲线参数设置及仿真', '预淀积阶段', '干氧2时间min:'] },
  'drawing-15-2': { controls: 5, text: ['磷扩散温度曲线参数设置及仿真', '再分布阶段', '氧气流量:　100L/min'] },
  'drawing-16-1': { controls: 3, text: ['硼扩散温度曲线参数设置及仿真', '温度曲线仿真'] },
  'drawing-16-2': { controls: 3, text: ['磷扩散温度曲线参数设置及仿真', '温度曲线仿真'] },
  'drawing-19-1': { controls: 9, text: ['NPN输出曲线', 'IB(uA)', 'Uce(V)', 'Ic(mA)'] },
  'drawing-19-2': { controls: 9, text: ['NMOS输出曲线', 'Ugs(V)', 'Uds(V)', 'ID(mA)'] },
};

test('all non-golden manufacturing drawings use the faithful common sandbox shell', () => {
  assert.deepEqual(sandboxes.map((block) => block.id).sort(), Object.keys(expected).sort());
  for (const block of sandboxes) {
    const contract = expected[block.id];
    assert.equal(block.modeSwitch, true, `${block.id} must use platform answer controls`);
    assert.match(block.html, /data-drawing-simulation/);
    assert.match(block.html, /<table\b/);
    assert.equal((block.html.match(/data-control-index=/g) || []).length, contract.controls);
    for (const sourceText of contract.text) assert.ok(block.html.includes(sourceText), `${block.id} lost ${sourceText}`);
    assert.match(block.html, /data-drawing-action="0"/);
    assert.ok(block.html.includes('清空'));
    assert.ok(block.html.includes("type:'pigeon-score'"));
    assert.ok(block.html.includes("type:'pigeon-score-clear'"));
    assert.ok(block.html.includes("type==='pigeon-sandbox-restore'"));
    assert.doesNotMatch(block.html, /formulaSource|参数\d+/);
    assert.doesNotMatch(block.html, /#[0-9a-f]{3,8}\b/i);
  }
});

test('device output tabs retain their source subtitle and two source images', () => {
  for (const [id, subtitle] of [['drawing-19-1', 'NPN测试数据'], ['drawing-19-2', 'NMOS测试数据']]) {
    const blocks = drawingTabs.get(id);
    assert.ok(blocks, `${id} activity tab missing`);
    const heading = blocks.find((block) => block.type === 'heading');
    const imageGroup = blocks.find((block) => block.type === 'imageGroup');
    assert.equal(heading?.text, subtitle);
    assert.equal(imageGroup?.images?.length, 2);
    assert.deepEqual(imageGroup.images.map((image) => image.alt), ['', '']);
    assert.ok(imageGroup.images.every((image) => /^assets\/images\/[a-f0-9]{64}\.png$/.test(image.src)));
  }
});
