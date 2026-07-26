#!/usr/bin/env node
import assert from 'node:assert/strict';

globalThis.document = {
  activeElement: null,
  createElement() {
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() { return this.textContent; },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
};
globalThis.CSS = { escape: (value) => String(value) };

const { handleParamSelectAction, renderParamSelect } = await import('../../../app/src/render/param-select.js');
const block = {
  type: 'paramSelect',
  id: 'simulation-image-test',
  title: '淀积参数',
  groups: [{
    params: [{ label: '工艺', options: ['A'], answerIndex: 1 }],
  }],
  simulations: [{
    label: '淀积厚度仿真',
    paramRange: [1, 1],
    images: [
      { src: 'assets/images/a.jpg', alt: 'CMOS1淀积厚度仿真', caption: 'CMOS1淀积厚度仿真' },
      { src: 'assets/images/b.jpg', alt: 'CMOS2淀积厚度仿真', caption: 'CMOS2淀积厚度仿真' },
    ],
  }],
};
const course = { resolveAsset: (src) => `resolved:${src}` };
let rendered = renderParamSelect(block, course);
const root = {
  querySelector: () => null,
  set outerHTML(value) { rendered = value; },
};
document.querySelector = () => root;
const states = {};
const store = {
  get: () => states,
  set: (_slot, value) => Object.assign(states, value),
};

handleParamSelectAction({ dataset: { action: 'param-select', paramId: block.id, param: '1' }, value: '1' }, store);
handleParamSelectAction({ dataset: { action: 'param-sim-toggle', paramId: block.id, sim: '0' } }, store);

assert.match(rendered, /<figure class="param-select-sim-figure">/);
assert.match(rendered, /src="resolved:assets\/images\/a\.jpg" alt="CMOS1淀积厚度仿真"/);
assert.match(rendered, /<figcaption>CMOS1淀积厚度仿真<\/figcaption>/);
assert.match(rendered, /src="resolved:assets\/images\/b\.jpg" alt="CMOS2淀积厚度仿真"/);
assert.match(rendered, /<figcaption>CMOS2淀积厚度仿真<\/figcaption>/);
assert.doesNotMatch(rendered, /\[object Object\]/);

console.log('param-select simulation image objects: ok');
