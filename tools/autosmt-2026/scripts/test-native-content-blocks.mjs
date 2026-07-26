import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('../../../app/node_modules/node-html-parser');

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

const { renderCourseContent } = await import('../../../app/src/render/content-renderer.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const root = {
  html: '',
  insertAdjacentHTML(_position, html) { this.html += html; },
};
const course = {
  manifest: {
    chapters: [{
      id: '1',
      title: 'One',
      sections: [{ id: '1.1', title: 'Section', knowledgePoints: [{ id: '1-1-1', title: 'Point' }] }],
    }],
  },
  content: {
    overviews: {},
    knowledgePoints: {
      '1-1-1': {
        title: 'Native blocks',
        blocks: [
          {
            type: 'tabSet',
            id: 'oxidation-tabs',
            tabs: [
              { id: 'theory', label: 'Theory', blocks: [{ type: 'paragraph', spans: [{ t: 'Theory content' }] }] },
              { id: 'video', label: 'Video', blocks: [{ type: 'paragraph', spans: [{ t: 'Video content' }] }] },
            ],
          },
          {
            type: 'list',
            ordered: true,
            items: [
              [{ t: 'First ' }, { t: 'preserved', b: true }],
              [{ t: 'Second item' }],
            ],
          },
          {
            type: 'imageGroup',
            images: [
              { src: 'assets/images/oxidation-a.png', alt: 'Oxidation specimen A', caption: 'First specimen' },
              { src: 'assets/images/oxidation-b.png', alt: 'Oxidation specimen B' },
            ],
          },
          {
            type: 'paramsTable',
            headers: [
              { text: 'Process', header: true, scope: 'col' },
              { text: 'Evidence', header: true, scope: 'col' },
            ],
            rows: [
              [
                { text: 'Oxidation', header: true, scope: 'row', rowspan: 2 },
                { spans: [{ t: 'Measured ', b: true }, { t: 'result' }], colspan: 2 },
              ],
              [
                { image: { src: 'assets/images/temperature.png', alt: 'Temperature profile' }, colspan: 2 },
              ],
            ],
          },
          {
            type: 'paramsTable',
            headers: ['Method', 'Equipment'],
            rows: [[
              { text: 'Coating and bake', rowspan: 2 },
              {
                images: [
                  { src: 'assets/images/spinner.png', alt: 'Spinner' },
                  { src: 'assets/images/hotplate.png', alt: 'Hot plate' },
                ],
                rowspan: 2,
              },
            ], ['Second row']],
          },
          {
            type: 'paramsTable',
            headers: ['Group', 'Item', 'Tail'],
            rows: [
              ['Group zero', 'Item zero', { text: 'Shared row-end tail', rowspan: 2 }],
              ['Group one', 'Item one'],
              ['Group two', 'Item two', 'Fresh tail after expiry'],
            ],
          },
          {
            type: 'paramsTable',
            headers: [
              { text: 'Identity', header: true, scope: 'col' },
              { text: 'Measurements', header: true, scope: 'col', colspan: 2 },
            ],
            rows: [['Sample A', 'Hot value', 'Cold value']],
          },
          {
            type: 'paramsTable',
            headers: [{ text: 'Oxide reference title', header: true, scope: 'col', colspan: 3 }],
            rows: [
              [
                { text: 'Color', header: true, scope: 'col' },
                { text: 'Minimum', header: true, scope: 'col' },
                { text: 'Maximum', header: true, scope: 'col' },
              ],
              ['Blue', '100 nm', '200 nm'],
            ],
          },
          {
            type: 'paramsTable',
            headers: [
              { text: 'Color band', header: true, scope: 'col' },
              { text: 'Oxide thickness', header: true, scope: 'col', colspan: 2 },
            ],
            rows: [['Green', '300 nm', '400 nm']],
          },
          {
            type: 'paramsTable',
            headers: ['Legacy name', 'Legacy value'],
            rows: [['Old string cell', 'Still supported']],
          },
          {
            type: 'compareBox',
            title: 'Process comparison',
            headers: ['Comparison item', 'DBG', 'DBT'],
            rows: [
              { label: 'Sequence', cells: ['Dice before grinding', 'Grind before dicing'] },
              { label: 'Risk', cells: ['Wafer warpage', 'Edge damage'] },
            ],
          },
          {
            type: 'image',
            src: 'assets/images/native.png\" onload=\"alert(1)',
            alt: 'Native image \" onload=\"alert(2)',
          },
          {
            type: 'imageGroup',
            images: [{
              src: 'assets/images/group.png\" onload=\"alert(3)',
              alt: 'Grouped image \" onload=\"alert(4)',
            }],
          },
          {
            type: 'paramsTable',
            headers: ['Injected media'],
            rows: [
              [{
                image: {
                  src: 'assets/images/table.png\" onload=\"alert(5)',
                  alt: 'Table image \" onload=\"alert(6)',
                },
              }],
              [{
                images: [{
                  src: 'assets/images/table-group.png\" onload=\"alert(7)',
                  alt: 'Table grouped image \" onload=\"alert(8)',
                }],
              }],
            ],
          },
          {
            type: 'video',
            title: 'Escaped media attributes',
            src: 'assets/media/video.mp4\" onload=\"alert(7)',
            poster: 'assets/images/poster.png\" onload=\"alert(8)',
            captions: 'assets/media/captions.vtt\" onload=\"alert(9)',
          },
        ],
      },
    },
  },
  quiz: { sectionQuizzes: {} },
  resolveAsset(value) { return `blob:native/${value}`; },
};

renderCourseContent(root, course, { get: () => ({}) });

// tabSet: first tab is selected; every tab and panel is connected by ARIA ids.
assert.match(root.html, /<[^>]*(?=[^>]*class="tab-set")(?=[^>]*data-tab-set-id="oxidation-tabs")(?=[^>]*role="tablist")[^>]*>/);
assert.match(root.html, /<[^>]*(?=[^>]*id="oxidation-tabs-tab-theory")(?=[^>]*role="tab")(?=[^>]*aria-selected="true")(?=[^>]*aria-controls="oxidation-tabs-panel-theory")[^>]*>/);
assert.match(root.html, /<[^>]*(?=[^>]*id="oxidation-tabs-tab-video")(?=[^>]*role="tab")(?=[^>]*aria-selected="false")(?=[^>]*tabindex="-1")(?=[^>]*aria-controls="oxidation-tabs-panel-video")[^>]*>/);
assert.match(root.html, /<[^>]*(?=[^>]*id="oxidation-tabs-panel-theory")(?=[^>]*role="tabpanel")(?=[^>]*aria-labelledby="oxidation-tabs-tab-theory")[^>]*>[^]*Theory content/);
assert.match(root.html, /<[^>]*(?=[^>]*id="oxidation-tabs-panel-video")(?=[^>]*role="tabpanel")(?=[^>]*hidden)[^>]*>[^]*Video content/);

// list: ordered structure retains Span rich-text semantics.
assert.match(root.html, /<ol class="course-list">\s*<li>First <strong>preserved<\/strong><\/li>\s*<li>Second item<\/li>\s*<\/ol>/);

// imageGroup: source order, alt text, optional caption, and resolved local assets are retained.
assert.match(root.html, /<div class="image-group">\s*<figure><img[^>]*src="blob:native\/assets\/images\/oxidation-a.png"[^>]*alt="Oxidation specimen A"[^>]*><figcaption>First specimen<\/figcaption><\/figure>\s*<figure><img[^>]*src="blob:native\/assets\/images\/oxidation-b.png"[^>]*alt="Oxidation specimen B"[^>]*><\/figure>\s*<\/div>/);

// paramsTable: old string cells remain valid, while rich cells retain table semantics and media.
assert.match(root.html, /<th(?=[^>]*scope="col")[^>]*>Process<\/th>/);
assert.match(root.html, /<th(?=[^>]*scope="row")(?=[^>]*rowspan="2")[^>]*>Oxidation<\/th>/);
assert.match(root.html, /<td(?=[^>]*colspan="2")(?=[^>]*data-label="Evidence")[^>]*><strong>Measured <\/strong>result<\/td>/);
assert.match(root.html, /<td(?=[^>]*colspan="2")(?=[^>]*data-label="Evidence")[^>]*><img(?=[^>]*src="blob:native\/assets\/images\/temperature.png")(?=[^>]*alt="Temperature profile")[^>]*><\/td>/);

const output = parse(root.html);

// paramsTable: a merged cell can retain multiple source images in order on desktop.
const equipmentTable = output.querySelectorAll('.params-table')
  .find((table) => table.textContent.includes('Coating and bake'));
assert.ok(equipmentTable);
const equipmentCell = equipmentTable.querySelector('tbody td[rowspan="2"]:last-child');
assert.ok(equipmentCell);
assert.ok(equipmentCell.querySelector('.params-table-cell-images'));
assert.deepEqual(equipmentCell.querySelectorAll('img').map((image) => ({
  src: image.getAttribute('src'),
  alt: image.getAttribute('alt'),
})), [
  { src: 'blob:native/assets/images/spinner.png', alt: 'Spinner' },
  { src: 'blob:native/assets/images/hotplate.png', alt: 'Hot plate' },
]);

const mobileTables = output.querySelectorAll('.params-table-mobile');
const mobileTableContaining = (text) => mobileTables.find((table) => table.textContent.includes(text));
const recordPairs = (record) => record.querySelectorAll('.params-table-field').map((field) => ({
  label: field.querySelector('.params-table-field-label')?.textContent.trim() || '',
  value: field.querySelector('.params-table-field-value')?.textContent.trim() || '',
}));

// The narrow-card representation keeps the same image order without flattening the table cell.
const equipmentMobile = mobileTableContaining('Coating and bake');
const equipmentMobileField = equipmentMobile.querySelectorAll('.params-table-field')
  .find((field) => field.querySelector('.params-table-field-label')?.textContent.trim() === 'Equipment');
assert.ok(equipmentMobileField);
assert.deepEqual(equipmentMobileField.querySelectorAll('img').map((image) => image.getAttribute('alt')), [
  'Spinner',
  'Hot plate',
]);

// A rowspan at the physical end of a row remains present in the next mobile record,
// then expires by row index instead of leaking into a later unrelated row.
const rowEndMobile = mobileTableContaining('Shared row-end tail');
assert.ok(rowEndMobile, 'row-end rowspan table must have an independent mobile representation');
const rowEndRecords = rowEndMobile.querySelectorAll('.params-table-record');
assert.equal(rowEndRecords.length, 3);
assert.deepEqual(recordPairs(rowEndRecords[1]), [
  { label: 'Group', value: 'Group one' },
  { label: 'Item', value: 'Item one' },
  { label: 'Tail', value: 'Shared row-end tail' },
]);
assert.deepEqual(recordPairs(rowEndRecords[2]), [
  { label: 'Group', value: 'Group two' },
  { label: 'Item', value: 'Item two' },
  { label: 'Tail', value: 'Fresh tail after expiry' },
]);

// A spanning column header labels every covered logical column on mobile.
const colspanDesktop = output.querySelectorAll('.params-table')
  .find((table) => table.textContent.includes('Measurements'));
assert.ok(colspanDesktop);
assert.equal(colspanDesktop.querySelector('thead th[colspan="2"]')?.textContent, 'Measurements');
const colspanMobile = mobileTableContaining('Measurements');
assert.deepEqual(recordPairs(colspanMobile.querySelector('.params-table-record')), [
  { label: 'Identity', value: 'Sample A' },
  { label: 'Measurements', value: 'Hot value' },
  { label: 'Measurements', value: 'Cold value' },
]);

// A full body header row supersedes a spanning title row for following mobile records.
const titledMobile = mobileTableContaining('Blue');
assert.equal(titledMobile.querySelectorAll('.params-table-record').length, 1);
assert.equal(titledMobile.querySelector('.params-table-mobile-title')?.textContent, 'Oxide reference title');
assert.equal(titledMobile.getAttribute('role'), undefined);
assert.equal(titledMobile.querySelector('.params-table-mobile-records')?.getAttribute('role'), 'list');
assert.deepEqual(recordPairs(titledMobile.querySelector('.params-table-record')), [
  { label: 'Color', value: 'Blue' },
  { label: 'Minimum', value: '100 nm' },
  { label: 'Maximum', value: '200 nm' },
]);

// Without a later full column-header row, colspan header labels remain shared.
const sharedHeaderMobile = mobileTableContaining('Oxide thickness');
assert.deepEqual(recordPairs(sharedHeaderMobile.querySelector('.params-table-record')), [
  { label: 'Color band', value: 'Green' },
  { label: 'Oxide thickness', value: '300 nm' },
  { label: 'Oxide thickness', value: '400 nm' },
]);

// Legacy string-only tables retain both desktop table data and mobile records.
const legacyDesktop = output.querySelectorAll('.params-table')
  .find((table) => table.textContent.includes('Old string cell'));
assert.ok(legacyDesktop);
assert.equal(legacyDesktop.querySelector('tbody td')?.textContent, 'Old string cell');
const legacyMobile = mobileTableContaining('Old string cell');
assert.deepEqual(recordPairs(legacyMobile.querySelector('.params-table-record')), [
  { label: 'Legacy name', value: 'Old string cell' },
  { label: 'Legacy value', value: 'Still supported' },
]);

// compareBox keeps its semantic table on wide cards and an equivalent labelled-record
// representation on narrow cards, so glossary processing can annotate the visible copy.
const compareBox = output.querySelector('.compare-box');
const compareDesktop = compareBox.querySelector('.compare-table');
const compareMobile = compareBox.querySelector('.compare-table-mobile');
assert.ok(compareDesktop);
assert.ok(compareMobile);
assert.equal(compareDesktop.querySelector('thead th[scope="col"]')?.textContent, 'Comparison item');
assert.equal(compareDesktop.querySelector('tbody th[scope="row"]')?.textContent, 'Sequence');
assert.equal(compareMobile.querySelector('.compare-table-mobile-records')?.getAttribute('role'), 'list');
assert.equal(compareMobile.querySelectorAll('.compare-table-record').length, 2);
const compareRecordPairs = (record) => record.querySelectorAll('.compare-table-field').map((field) => ({
  label: field.querySelector('.compare-table-field-label')?.textContent.trim() || '',
  value: field.querySelector('.compare-table-field-value')?.textContent.trim() || '',
}));
assert.deepEqual(compareRecordPairs(compareMobile.querySelector('.compare-table-record')), [
  { label: 'Comparison item', value: 'Sequence' },
  { label: 'DBG', value: 'Dice before grinding' },
  { label: 'DBT', value: 'Grind before dicing' },
]);
assert.match(compareDesktop.textContent, /DBG/);
assert.match(compareMobile.textContent, /DBG/);

// Every native media attribute is escaped as an attribute, not as body text.
const nativeImage = output.querySelectorAll('img').find((image) => image.getAttribute('alt')?.startsWith('Native image'));
const groupedImage = output.querySelectorAll('img').find((image) => image.getAttribute('alt')?.startsWith('Grouped image'));
const tableImage = output.querySelectorAll('img').find((image) => image.getAttribute('alt')?.startsWith('Table image'));
const tableGroupedImage = output.querySelectorAll('img').find((image) => image.getAttribute('alt')?.startsWith('Table grouped image'));
for (const image of [nativeImage, groupedImage, tableImage, tableGroupedImage]) {
  assert.ok(image);
  assert.equal(Object.hasOwn(image.attributes, 'onload'), false);
  assert.match(image.getAttribute('src'), /^blob:native\//);
}
const video = output.querySelector('video');
assert.equal(Object.hasOwn(video.attributes, 'onload'), false);
assert.equal(Object.hasOwn(video.querySelector('source').attributes, 'onload'), false);
assert.equal(Object.hasOwn(video.querySelector('track').attributes, 'onload'), false);
assert.match(video.getAttribute('poster'), /^blob:native\//);
assert.match(video.querySelector('source').getAttribute('src'), /^blob:native\//);
assert.match(video.querySelector('track').getAttribute('src'), /^blob:native\//);

// Mobile layout must retain the control and table semantics without horizontal scrolling.
const learnCss = readFileSync(path.join(ROOT, 'app', 'src', 'styles', 'learn.css'), 'utf8');
assert.match(learnCss, /\.tab-set[^{}]*\{[^}]*flex-wrap\s*:\s*wrap/);
assert.match(learnCss, /\.tab-set-tab:focus-visible/);
assert.match(learnCss, /\.image-group[^{}]*\{[^}]*grid-template-columns/);
assert.match(learnCss, /@media\s*\(max-width:\s*768px\)[^]*\.image-group[^{}]*\{[^}]*grid-template-columns\s*:\s*1fr/);
assert.match(learnCss, /\.params-table-mobile\s*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /@media\s*\(max-width:\s*768px\)[^]*\.params-table-wrap\s*>\s*\.params-table\s*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /@media\s*\(max-width:\s*768px\)[^]*\.params-table-mobile\s*\{[^}]*display\s*:\s*grid/);
assert.match(learnCss, /\.params-table[^{}]*\{[^}]*table-layout\s*:\s*fixed/);
assert.doesNotMatch(learnCss, /\.params-table-wrap[^{}]*\{[^}]*overflow-x\s*:\s*(?:auto|scroll)/);
assert.match(learnCss, /\.compare-table-mobile\s*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /@media\s*\(max-width:\s*768px\)[^]*\.compare-table-wrap\s*>\s*\.compare-table\s*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /@media\s*\(max-width:\s*768px\)[^]*\.compare-table-mobile\s*\{[^}]*display\s*:\s*grid/);
assert.match(learnCss, /@container\s*\(max-width:\s*720px\)[^]*\.compare-table-wrap\s*>\s*\.compare-table\s*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /\.compare-table[^{}]*\{[^}]*table-layout\s*:\s*fixed/);
assert.doesNotMatch(learnCss, /\.table-scroll\s*>\s*\.compare-table[^{}]*\{[^}]*min-width\s*:\s*max-content/);
assert.doesNotMatch(learnCss, /\.card-body[^{}]*overflow-x\s*:\s*(?:auto|scroll)/);

// Glossary navigation must prefer the representation visible at the current breakpoint.
const { navigateToTerm } = await import('../../../app/src/render/glossary.js');
const scrolled = [];
const hiddenTerm = {
  dataset: { abbr: 'Oxidation' },
  style: {},
  getClientRects: () => [],
  scrollIntoView: () => scrolled.push('hidden'),
};
const visibleTerm = {
  dataset: { abbr: 'Oxidation' },
  style: {},
  getClientRects: () => [{ width: 10, height: 10 }],
  scrollIntoView: () => scrolled.push('visible'),
};
document.querySelectorAll = () => [hiddenTerm, visibleTerm];
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback) => { callback(); return 0; };
navigateToTerm('Oxidation');
assert.deepEqual(scrolled, ['visible']);

const fallbackFirst = {
  dataset: { abbr: 'Fallback' },
  style: {},
  scrollIntoView: () => scrolled.push('fallback-first'),
};
const fallbackSecond = {
  dataset: { abbr: 'Fallback' },
  style: {},
  scrollIntoView: () => scrolled.push('fallback-second'),
};
document.querySelectorAll = () => [fallbackFirst, fallbackSecond];
navigateToTerm('Fallback');
globalThis.setTimeout = originalSetTimeout;
assert.deepEqual(scrolled, ['visible', 'fallback-first']);

console.log('native-content-blocks: ok');
