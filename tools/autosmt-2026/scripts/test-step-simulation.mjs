import assert from 'node:assert/strict';

globalThis.document = {
  createElement() {
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() { return this.textContent; },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
  addEventListener() {},
};

const { initStepSimulations, renderStepSimulation } = await import('../../../app/src/render/step-simulation.js');

const course = { resolveAsset: (value) => `resolved/${value}` };
const html = renderStepSimulation({
  type: 'stepSimulation',
  id: 'test-flow',
  title: 'Test flow',
  steps: [
    { prompt: 'Step one', options: ['A', 'B'], answerIndex: 2, clip: 'assets/media/step-1.mp4' },
    { prompt: 'Step two', options: ['C', 'D'], answerIndex: 1, clip: 'assets/media/step-2.mp4' },
  ],
}, course);

assert.match(html, /data-simulation-id="test-flow"/);
assert.match(html, /Step one/);
assert.equal((html.match(/<select class="step-simulation-choice"/g) || []).length, 2);
assert.doesNotMatch(html, /step-simulation-choice[^>]*disabled/);
assert.match(html, /data-action="simulation-submit"/);
assert.match(html, />提交<\/button>/);
assert.match(html, /step-simulation-video-empty/);
assert.doesNotMatch(html, /<video/);
assert.doesNotMatch(html, /step-simulation-media-status/);
assert.doesNotMatch(html, /step-simulation-feedback/);
// 扁平写法 = 单组无组头:不渲染组壳,进度分母 = 步骤数
assert.doesNotMatch(html, /step-simulation-group-head/);
assert.match(html, /进度 0\/2/);
assert.match(html, /data-action="simulation-fullscreen"/);

// groups 形态:组头本身是下拉答题项(契约 §2.5);计分/进度分母 = 组头题 + 步骤题
const grouped = renderStepSimulation({
  type: 'stepSimulation',
  id: 'test-grouped',
  title: 'Grouped flow',
  groups: [
    {
      prompt: '功能区',
      options: ['栅氧化区', '光刻区'],
      answerIndex: 1,
      steps: [
        { prompt: 'G1 step', options: ['A', 'B'], answerIndex: 2, clip: 'assets/media/g1-1.mp4' },
      ],
    },
    {
      prompt: '功能区二',
      options: ['刻蚀区', '注入区'],
      answerIndex: 2,
      steps: [
        { prompt: 'G2 step', options: ['C', 'D'], answerIndex: 1, clip: 'assets/media/g2-1.mp4' },
        { prompt: 'G2 step2', options: ['E', 'F'], answerIndex: 2, clip: 'assets/media/g2-2.mp4' },
      ],
    },
  ],
}, course);

assert.equal((grouped.match(/step-simulation-group-head/g) || []).length, 2);
assert.equal((grouped.match(/data-action="simulation-group-select"/g) || []).length, 2);
assert.match(grouped, /进度 0\/5/); // 2 组头 + 3 步骤
assert.match(grouped, /data-action="simulation-toggle-group"/);
// 手风琴默认展开第一个未完成组:组1展开,组2收起(hidden)
assert.match(grouped, /aria-expanded="true"/);
assert.match(grouped, /aria-expanded="false"/);
// 步骤号全局连续(01..03)
assert.match(grouped, /data-step="1"/);
assert.match(grouped, /data-step="3"/);

globalThis.CSS = { escape: (value) => String(value) };
const root = {
  html: '',
  querySelector() { return null; },
  querySelectorAll() { return []; },
  set outerHTML(value) { this.html = value; },
};
document.activeElement = null;
document.querySelector = () => root;
initStepSimulations({
  get(slot, fallback) {
    if (slot !== 'simulations') return fallback;
    return {
      'test-flow': {
        version: 2,
        mode: 'practice',
        displayStep: 1,
        selected: { 1: 2 },
        played: { 1: true },
      },
    };
  },
  set() {},
});
assert.match(root.html, /step-simulation-video-empty/);
assert.doesNotMatch(root.html, /<video/);
console.log('step-simulation: ok');
