import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('../../../app/node_modules/node-html-parser');
const { strFromU8, unzipSync } = require('../../../app/node_modules/fflate');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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

const { sanitizeLegacyHtml } = await import('../../../app/src/render/content-renderer.js');

const course = {
  resolveAsset(value) { return `blob:legacy/${value}`; },
};

const malicious = `
  <script>alert('script')</script>
  <style>body{display:none}</style>
  <link rel="stylesheet" href="assets/evil.css">
  <iframe src="https://example.invalid"></iframe>
  <object data="assets/evil.bin"></object>
  <embed src="assets/evil.bin">
  <form action="javascript:alert(1)"><input value="unsafe"><button>Unsafe control</button></form>
  <table class="params-table evil-class" style="width:9999px" onclick="alert(2)">
    <thead><tr><th colspan="2" data-private="x">Safe heading</th></tr></thead>
    <tbody>
      <tr>
        <td rowspan="2"><a href="javascript:alert(3)">Preserved static text</a></td>
        <td><img loading="lazy" src="assets/images/safe.png" alt="Safe &quot; onload=&quot;still text" style="width:9999px" onerror="alert(4)"></td>
      </tr>
      <tr><td><img src="java&#x73;cript:alert(5)" alt="Dangerous URL"></td></tr>
    </tbody>
  </table>
`;

const sanitized = sanitizeLegacyHtml(malicious, course);
const sanitizedDom = parse(sanitized);

assert.equal(sanitizedDom.querySelector('script,style,link,iframe,object,embed,form,input,button,a'), null);
assert.match(sanitizedDom.textContent, /Preserved static text/);
const safeTable = sanitizedDom.querySelector('table');
assert.equal(safeTable.getAttribute('class'), 'params-table');
assert.equal(safeTable.getAttribute('style'), undefined);
assert.equal(safeTable.getAttribute('onclick'), undefined);
assert.equal(safeTable.querySelector('th').getAttribute('colspan'), '2');
assert.equal(safeTable.querySelector('th').getAttribute('data-private'), undefined);
assert.equal(safeTable.querySelector('td').getAttribute('rowspan'), '2');

const sanitizedImages = safeTable.querySelectorAll('img');
assert.equal(sanitizedImages.length, 2);
assert.equal(sanitizedImages[0].getAttribute('src'), 'blob:legacy/assets/images/safe.png');
assert.equal(sanitizedImages[0].getAttribute('alt'), 'Safe " onload="still text');
assert.equal(sanitizedImages[0].getAttribute('style'), undefined);
assert.equal(sanitizedImages[0].getAttribute('onerror'), undefined);
assert.equal(sanitizedImages[1].getAttribute('src'), undefined);
assert.equal(sanitizedImages[1].getAttribute('alt'), 'Dangerous URL');

function stripJsonComments(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (current === '\n') { lineComment = false; out += current; }
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') { blockComment = false; index += 1; }
      continue;
    }
    if (inString) {
      out += current;
      if (escaped) escaped = false;
      else if (current === '\\') escaped = true;
      else if (current === '"') inString = false;
      continue;
    }
    if (current === '"') { inString = true; out += current; continue; }
    if (current === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (current === '/' && next === '*') { blockComment = true; index += 1; continue; }
    out += current;
  }
  return out;
}

const packagingArchive = unzipSync(new Uint8Array(
  readFileSync(path.join(ROOT, 'dist-courses', 'ic-packaging.pigeon')),
));
const packagingContent = JSON.parse(stripJsonComments(strFromU8(packagingArchive['content.json'])));
const legacyBlocks = Object.values(packagingContent.knowledgePoints)
  .flatMap((point) => point.blocks || [])
  .filter((block) => block.type === 'html');
assert.equal(legacyBlocks.length, 1);

const packagingSanitized = sanitizeLegacyHtml(legacyBlocks[0].html, course);
const packagingDom = parse(packagingSanitized);
const packagingTable = packagingDom.querySelector('table.params-table');
assert.ok(packagingTable);
assert.match(packagingTable.textContent, /SOP工艺流程/);
assert.match(packagingTable.textContent, /背面研磨保护/);
assert.ok(packagingTable.querySelector('td[rowspan="3"]'));
assert.ok(packagingTable.querySelector('td[rowspan="4"]'));
const packagingImages = packagingTable.querySelectorAll('img');
assert.equal(packagingImages.length, 6);
for (const image of packagingImages) {
  assert.match(image.getAttribute('src'), /^blob:legacy\/assets\/images\/chapter5\/sop_process_\d\.png$/);
  assert.equal(image.getAttribute('onerror'), undefined);
  assert.equal(image.getAttribute('style'), undefined);
}

console.log('legacy-html-sanitizer: ok');
