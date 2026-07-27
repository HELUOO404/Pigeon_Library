import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('../../../app/node_modules/node-html-parser');

globalThis.document = {
  createElement(tagName) {
    if (String(tagName).toLowerCase() === 'template') {
      let content = parse('');
      return {
        get content() { return content; },
        set innerHTML(value) { content = parse(String(value)); },
        get innerHTML() { return content.toString(); },
      };
    }
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() { return this.textContent; },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });

const { renderCourseContent, renderSandboxBlock } = await import('../../../app/src/render/content-renderer.js');

const root = {
  html: '',
  insertAdjacentHTML(_position, html) { this.html += html; },
};
const course = {
  manifest: {
    chapters: [{ id: '1', title: 'One', sections: [{ id: '1.1', title: 'Section', knowledgePoints: [{ id: '1-1-1', title: 'Point' }] }] }],
  },
  content: {
    overviews: {
      '1.1': {
        title: 'Overview',
        blocks: [
          {
            type: 'html',
            html: "<link href='assets/sim/styles.css'><script src='assets/sim/runtime.js'></script><style>.bad{display:none}</style><iframe src='assets/embed.html'></iframe><object data='assets/object.bin'></object><form><input></form><table class='params-table bad' style='width:9999px' onclick='alert(1)'><tbody><tr><td rowspan='2'>Legacy text</td><td><img loading='lazy' src='assets/images/source.png' onerror='alert(2)' style='width:9999px'></td></tr><tr><td><video controls poster='assets/images/legacy-poster.png'><source src='assets/media/legacy.mp4' type='video/mp4'><track kind='captions' src='assets/media/legacy.vtt' srclang='zh' default></video></td></tr></tbody></table>",
          },
          {
            type: 'video',
            title: 'Lecture',
            src: 'assets/media/lecture.m4v',
            poster: 'assets/images/poster.png',
            captions: 'assets/media/lecture.vtt',
          },
        ],
      },
    },
    knowledgePoints: { '1-1-1': { title: 'Point', blocks: [] } },
  },
  quiz: { sectionQuizzes: {} },
  resolveAsset(value) { return `blob:qa/${value}`; },
};

renderCourseContent(root, course, { get: () => ({}) });
const output = parse(root.html);
assert.equal(output.querySelector('link,script,style,iframe,object,form,input'), null);
const legacyTable = output.querySelector('.course-html table.params-table');
assert.ok(legacyTable);
assert.match(legacyTable.textContent, /Legacy text/);
assert.equal(legacyTable.getAttribute('class'), 'params-table');
assert.equal(legacyTable.getAttribute('style'), undefined);
assert.equal(legacyTable.getAttribute('onclick'), undefined);
assert.equal(legacyTable.querySelector('td').getAttribute('rowspan'), '2');
const legacyImage = legacyTable.querySelector('img');
assert.equal(legacyImage.getAttribute('src'), 'blob:qa/assets/images/source.png');
assert.equal(legacyImage.getAttribute('onerror'), undefined);
assert.equal(legacyImage.getAttribute('style'), undefined);
const legacyVideo = legacyTable.querySelector('video');
assert.equal(legacyVideo.getAttribute('poster'), 'blob:qa/assets/images/legacy-poster.png');
assert.equal(legacyVideo.querySelector('source').getAttribute('src'), 'blob:qa/assets/media/legacy.mp4');
assert.equal(legacyVideo.querySelector('track').getAttribute('src'), 'blob:qa/assets/media/legacy.vtt');
assert.match(root.html, /data-src="blob:qa\/assets\/media\/lecture.m4v"/);
assert.match(root.html, /data-poster="blob:qa\/assets\/images\/poster.png"/);
assert.match(root.html, /data-captions="blob:qa\/assets\/media\/lecture.vtt"/);
assert.doesNotMatch(root.html, /<figure class="course-video"[^]*?<video/);

const sandboxMarkup = renderSandboxBlock({
  type: 'sandbox',
  html: '<button type="button" data-inside-sandbox>Inside</button>',
  height: 360,
  modeSwitch: true,
}, course);
const sandboxOutput = parse(sandboxMarkup);
const sandboxWrapper = sandboxOutput.querySelector('.sandbox-wrapper[data-sandbox-mode="practice"]');
assert.ok(sandboxWrapper, 'modeSwitch sandbox 必须记录当前外层模式');
const modeButtons = sandboxWrapper.querySelectorAll('[data-action="switch-sandbox-mode"]');
assert.equal(modeButtons.length, 2, 'modeSwitch sandbox 必须渲染两个站点原生模式按钮');
assert.deepEqual(modeButtons.map((button) => button.getAttribute('data-mode')), ['practice', 'answer']);
assert.deepEqual(modeButtons.map((button) => button.textContent.trim()), ['操作练习', '参考答案']);
assert.equal(modeButtons[0].getAttribute('aria-pressed'), 'true');
assert.equal(modeButtons[1].getAttribute('aria-pressed'), 'false');
assert.ok(sandboxWrapper.querySelector('.step-simulation-modes'));
const sandboxFrame = sandboxWrapper.querySelector('iframe.sandbox-frame');
assert.ok(sandboxFrame);
assert.equal(parse(renderSandboxBlock({ type: 'sandbox', html: '' }, course)).querySelector('.sandbox-mode-toolbar'), null);
console.log('offline-content-renderer: ok');
