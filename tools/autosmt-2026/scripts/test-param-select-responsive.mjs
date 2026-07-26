import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.document = {
  createElement() {
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() { return this.textContent; },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
};

const { handleParamSelectAction, renderParamSelect } = await import('../../../app/src/render/param-select.js');

const html = renderParamSelect({
  type: 'paramSelect',
  id: 'responsive-params',
  headers: ['序号', '结构', '工艺', '参数名称', '选择'],
  groups: [{
    merged: [{ images: [
      { src: 'assets/images/structure-a.png', alt: '结构图 A' },
      { src: 'assets/images/structure-b.png', alt: '结构图 B' },
    ] }, '热氧化'],
    params: [
      { label: '氧化时间', options: ['10min', '20min'], answerIndex: 2 },
      { label: '氧化温度', options: ['900C', '1000C'], answerIndex: 1 },
    ],
  }],
}, { resolveAsset: (src) => `resolved/${src}` });

assert.match(html, /class="[^"]*param-select-table-wrap/);
assert.match(html, /class="param-select-mobile"/);
assert.match(html, /param-select-mobile-field-label">序号/);
assert.match(html, /param-select-mobile-field-label">结构/);
assert.match(html, /param-select-mobile-field-label">工艺/);
assert.match(html, /param-select-mobile-field-label">参数名称/);
assert.match(html, /param-select-mobile-field-label">选择/);
assert.equal((html.match(/data-action="param-select"/g) || []).length, 4);
assert.match(html, /resolved\/assets\/images\/structure-a\.png[\s\S]*resolved\/assets\/images\/structure-b\.png/);
assert.match(html, /resolved\/assets\/images\/structure-a\.png" alt="结构图 A"/);
assert.match(html, /resolved\/assets\/images\/structure-b\.png" alt="结构图 B"/);
assert.doesNotMatch(html, /\[object Object\]/);
assert.equal((html.match(/class="param-select-mobile-group-context"/g) || []).length, 1);
assert.equal((html.match(/class="param-select-mobile-record"/g) || []).length, 2);

const css = await readFile(new URL('../../../app/src/styles/learn.css', import.meta.url), 'utf8');
assert.match(css, /@media\(max-width:768px\)\{[\s\S]*?\.param-select-table-wrap\{display:none\}/);
assert.match(css, /\.param-select-mobile\{display:grid;gap:14px;margin-top:12px\}/);
assert.doesNotMatch(css, /\.param-select-mobile-record\{[^}]*border-radius/);

globalThis.CSS = { escape: (value) => String(value) };
const root = {
  html: '',
  set outerHTML(value) { this.html = value; },
  focus() {},
};
document.activeElement = null;
const queries = [];
document.querySelector = (selector) => {
  queries.push(selector);
  return root;
};
const states = {};
const store = {
  get(slot, fallback) { return slot === 'simulations' ? states : fallback; },
  set(slot, value) { states[slot] = value; },
};
assert.equal(handleParamSelectAction({
  dataset: { action: 'param-select', paramId: 'responsive-params', param: '1' },
  value: '2',
}, store), true);
assert.equal((root.html.match(/<option value="2" selected>20min<\/option>/g) || []).length, 2);
document.activeElement = {
  dataset: { param: '2', paramId: 'responsive-params' },
  closest(selector) { return selector === '.param-select-mobile' ? root : null; },
};
assert.equal(handleParamSelectAction({
  dataset: { action: 'param-select', paramId: 'responsive-params', param: '2' },
  value: '1',
}, store), true);
assert.match(queries.at(-1), /\.param-select-mobile \[data-param="2"\]/);

console.log('param-select-responsive: ok');
