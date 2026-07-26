import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = {
  createElement() {
    return {
      textContent: '',
      appendChild(node) { this.textContent = node.textContent; },
      get innerHTML() {
        return this.textContent
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      },
    };
  },
  createTextNode(value) { return { textContent: String(value) }; },
};

const sidebarModule = await import('../../../app/src/render/sidebar-renderer.js');
const { renderSidebar, setSidebarSection, toggleSidebarChapter } = sidebarModule;
assert.equal(typeof sidebarModule.getReadingSectionId, 'function', 'sidebar must expose reading-position section tracking');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const container = { innerHTML: '' };
const manifest = {
  chapters: [
    {
      id: '1',
      title: '第1章 IC制造工艺',
      sections: [
        {
          id: '1.2',
          title: '第1.2节 氧化',
          knowledgePoints: [
            { id: '1-2-1', title: '介质薄膜' },
            { id: '1-2-2', title: '二氧化硅膜' },
          ],
        },
      ],
    },
    {
      id: '2',
      title: '第2章 半导体器件基础',
      sections: [
        {
          id: '2.1',
          title: '第2.1节 PN结',
          knowledgePoints: [{ id: '2-1-1', title: '平衡PN结' }],
        },
      ],
    },
  ],
};
const store = { get: () => ({ '1-2-1': 'read' }) };

renderSidebar(container, manifest, store, '1', '1.2');

assert.match(container.innerHTML, /<section class="tree-chapter is-current is-expanded" data-ch="1">/);
assert.match(container.innerHTML, /<button[^>]*class="tree-title"[^>]*data-action="switch-sidebar-chapter"[^>]*data-chapter="1"[^>]*aria-expanded="true"[^>]*aria-controls="tree-chapter-1"/);
assert.match(container.innerHTML, /<div class="tree-chapter-body" id="tree-chapter-1" aria-hidden="false">\s*<div class="tree-chapter-content">/);
assert.match(container.innerHTML, /<section class="tree-subsection"[^>]*aria-labelledby="tree-section-1-2">/);
assert.match(container.innerHTML, /<button[^>]*class="tree-section-label read active"[^>]*data-action="navigate"[^>]*data-section="1.2"[^>]*aria-current="location"/);
assert.match(container.innerHTML, /<div class="tree-knowledge-list">[^]*data-card="kp-1-2-1"[^]*data-card="kp-1-2-2"[^]*<\/div>/);

assert.match(container.innerHTML, /<section class="tree-chapter" data-ch="2">[^]*aria-expanded="false"[^]*<div class="tree-chapter-body" id="tree-chapter-2" aria-hidden="true">\s*<div class="tree-chapter-content">/);
assert.doesNotMatch(container.innerHTML, /tree-chapter-body hidden/);
assert.doesNotMatch(container.innerHTML, /class="tree-(?:item|section-label)"[^>]*style=/);
assert.doesNotMatch(container.innerHTML, /var\(--c1\)/);

const classSet = (initial = []) => {
  const values = new Set(initial);
  return {
    toggle(name, enabled) { if (enabled) values.add(name); else values.delete(name); },
    contains(name) { return values.has(name); },
    has(name) { return values.has(name); },
    add(name) { values.add(name); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
  };
};
const chapterBody = {
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = String(value); },
};
const chapterTitle = { attrs: {}, setAttribute(name, value) { this.attrs[name] = String(value); } };
const chapter = {
  dataset: { ch: '1' },
  classList: classSet(['is-current', 'is-expanded']),
  querySelector(selector) { return selector === '.tree-chapter-body' ? chapterBody : chapterTitle; },
};
globalThis.document.querySelectorAll = (selector) => selector === '.tree-chapter' ? [chapter] : [];
toggleSidebarChapter('1');
assert.equal(chapter.classList.contains('is-expanded'), false);
assert.equal(chapterTitle.attrs['aria-expanded'], 'false');
assert.equal(chapterBody.attrs['aria-hidden'], 'true');
toggleSidebarChapter('1');
assert.equal(chapter.classList.contains('is-expanded'), true);
assert.equal(chapterTitle.attrs['aria-expanded'], 'true');
assert.equal(chapterBody.attrs['aria-hidden'], 'false');

const sectionLabels = [
  { dataset: { section: '1.2' }, classList: classSet(['read']), attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; } },
  { dataset: { section: '2.1' }, classList: classSet(['opened', 'active']), attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; } },
];
globalThis.document.querySelectorAll = (selector) => selector === '.tree-section-label' ? sectionLabels : [];
setSidebarSection('1.2');
assert.equal(sectionLabels[0].classList.contains('active'), true);
assert.equal(sectionLabels[0].attrs['aria-current'], 'location');
assert.equal(sectionLabels[1].classList.contains('active'), false);
assert.equal(Object.hasOwn(sectionLabels[1].attrs, 'aria-current'), false);

const readingSections = [
  { id: '4.1', chapterId: '4', knowledgePoints: [{ id: '4-1-1' }] },
  { id: '4.2', chapterId: '4', knowledgePoints: [{ id: '4-2-1' }] },
  { id: '4.3', chapterId: '4', knowledgePoints: [{ id: '4-3-1' }] },
];
const readingAnchors = new Map([
  ['overview-4-1', { getBoundingClientRect: () => ({ top: -240 }) }],
  ['overview-4-2', { getBoundingClientRect: () => ({ top: 170 }) }],
  ['overview-4-3', { getBoundingClientRect: () => ({ top: 880 }) }],
]);
globalThis.document.getElementById = (id) => readingAnchors.get(id) || null;
const main = {
  clientHeight: 800,
  scrollHeight: 2400,
  scrollTop: 900,
  getBoundingClientRect: () => ({ top: 0 }),
};
assert.equal(sidebarModule.getReadingSectionId(readingSections, main, '4'), '4.1');
readingAnchors.set('overview-4-2', { getBoundingClientRect: () => ({ top: 120 }) });
assert.equal(sidebarModule.getReadingSectionId(readingSections, main, '4'), '4.2');
main.scrollTop = 1600;
assert.equal(sidebarModule.getReadingSectionId(readingSections, main, '4'), '4.3', 'bottom of chapter selects the final section');

const mainSource = readFileSync(path.join(ROOT, 'app', 'src', 'main-learn.js'), 'utf8');
const contentSource = readFileSync(path.join(ROOT, 'app', 'src', 'render', 'content-renderer.js'), 'utf8');
assert.match(mainSource, /setSidebarChapter\(chapterId\)/);
assert.match(mainSource, /action === 'switch-sidebar-chapter'/);
assert.match(mainSource, /toggleSidebarChapter\(target\.dataset\.chapter\)/);
assert.match(mainSource, /setSidebarSection\(currentSection\)/);
assert.match(mainSource, /import\s*\{\s*createStore,\s*globalGet,\s*globalSet\s*\}\s*from '\.\/core\/store\.js'/, 'learning page must read the persisted resume record');
assert.match(mainSource, /const lastCourse = globalGet\('lastCourse', null\);/, 'initialization must load the persisted resume record');
assert.match(mainSource, /lastCourse\?\.id === course\.id/, 'resume data must be accepted only for the loaded course');
assert.match(mainSource, /const resumeSection =\s*lastCourse\?\.id === course\.id\s*\? sections\.find\(\(section\) => section\.id === lastCourse\?\.sectionId\)/, 'resume data must resolve to a valid current-course section');
assert.match(mainSource, /currentChapter = resumeSection\?\.chapterId \|\| course\.manifest\.chapters\[0\]\?\.id \|\| '';/, 'invalid resume data must fall back to the first chapter');
assert.match(mainSource, /currentSection = resumeSection\?\.id \|\| sections\[0\]\?\.id \|\| '';/, 'invalid resume data must fall back to the first section');
assert.match(mainSource, /renderTabs\(document\.getElementById\('chapterTabs'\), course\.manifest\);[^]*?tab\.classList\.toggle\('active', tab\.dataset\.chapter === currentChapter\)/, 'restored chapters must also activate their matching top tab');
assert.match(mainSource, /function switchChapter\(chapterId\) \{[^]*?currentSection = firstSection\.id;[^]*?document\.getElementById\('main'\)\.scrollTop = 0;/, 'switching chapters must reset the main reading position');
assert.match(mainSource, /let readingNavigationRequestId = 0;/, 'scroll synchronization needs a navigation gate');
assert.match(mainSource, /let readingNavigationTarget = null;/, 'navigation must retain its target while late layout changes settle');
assert.match(mainSource, /if \(readingNavigationRequestId\) return;/, 'scroll synchronization must not overwrite the target section while navigation is in progress');
assert.match(mainSource, /function navigateTo\(sectionId, cardId\) \{\s*const requestId = \+\+navigationRequestId;\s*readingNavigationRequestId = requestId;/, 'navigation must activate the gate before chapter/card transitions can schedule reading synchronization');
assert.match(mainSource, /main\.addEventListener\('scrollend',[^]*?scheduleReadingPositionRelease/, 'scrollend must start a layout-settle window instead of releasing immediately');
assert.match(mainSource, /function reconcileReadingNavigation\(\)[^]*?readingNavigationTarget\.scrollIntoView\(\{ behavior: 'auto'/, 'late content resizing must realign the persisted navigation target');
assert.match(mainSource, /main\.addEventListener\('wheel',\s*cancelReadingNavigation/, 'manual scrolling must immediately return control to live reading tracking');
assert.match(mainSource, /readingNavigationRequestId = requestId;/, 'programmatic navigation must activate the scroll synchronization gate');
assert.match(mainSource, /main\.addEventListener\('scroll',\s*scheduleReadingPositionSync,\s*\{\s*passive:\s*true\s*\}\)/);
assert.match(mainSource, /ResizeObserver\(reconcileReadingNavigation\)/);
assert.doesNotMatch(mainSource, /pglib-expanded-cards|restoreExpandedCards|readExpandedCards|writeExpandedCards/);
assert.match(mainSource, /event\.propertyName === 'height'/);
assert.match(mainSource, /body\.querySelector\('\.card-body-content'\)\?\.scrollHeight/);
assert.match(mainSource, /setCardExpanded\(target,\s*expanded,\s*afterExpand\)/);
assert.match(mainSource, /requestIdleCallback\(processTerms,\s*\{\s*timeout:\s*800\s*\}\)/);
assert.match(mainSource, /behavior:\s*reducedMotion\s*\?\s*'auto'\s*:\s*'smooth'/);
assert.match(mainSource, /body\.addEventListener\('transitionend',\s*finishNavigation\)/);
assert.ok(mainSource.indexOf('initParamSelects(store);') < mainSource.indexOf('initReadingPositionTracking();'), 'interactive content must finish its initial layout before resume tracking starts');
assert.doesNotMatch(mainSource, /setTimeout\(\(\)\s*=>\s*\{\s*card\.scrollIntoView/);
assert.match(contentSource, /<div class="card-body-content">/);

const learnCss = readFileSync(path.join(ROOT, 'app', 'src', 'styles', 'learn.css'), 'utf8');
assert.match(learnCss, /\.tree-section-label[^{}]*\{[^}]*white-space\s*:\s*normal/);
assert.match(learnCss, /\.tree-item[^{}]*\{[^}]*overflow-wrap\s*:\s*anywhere/);
assert.match(learnCss, /\.tree-chapter:not\(\.is-expanded\) \.tree-title \.arrow/);
assert.match(learnCss, /\.tree-chapter-body[^{}]*\{[^}]*display\s*:\s*grid[^}]*grid-template-rows\s*:\s*1fr[^}]*transition\s*:/);
assert.match(learnCss, /\.tree-chapter-content[^{}]*\{[^}]*min-height\s*:\s*0[^}]*overflow\s*:\s*hidden/);
assert.match(learnCss, /\.tree-chapter:not\(\.is-expanded\) \.tree-chapter-body[^{}]*\{[^}]*grid-template-rows\s*:\s*0fr/);
assert.doesNotMatch(learnCss, /\.tree-chapter-body\.hidden[^{}]*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /\.tree-title[^{}]*\{[^}]*width\s*:\s*calc\(100% - 20px\)[^}]*margin\s*:\s*6px 10px[^}]*border-radius\s*:\s*var\(--radius\)/);
assert.doesNotMatch(learnCss, /\.tree-title[^{}]*\{[^}]*width\s*:\s*100%/);
assert.match(learnCss, /\.card-body[^{}]*\{[^}]*height\s*:\s*auto[^}]*transition\s*:\s*height/);
assert.match(learnCss, /\.card-body[^{}]*\{[^}]*transition\s*:\s*height\s+calc\(var\(--dur-slow\)\s*\*\s*1\.3\)/);
assert.match(learnCss, /\.card-body-content[^{}]*\{[^}]*min-height\s*:\s*0[^}]*padding\s*:\s*0 22px 22px/);
assert.match(learnCss, /\.card-body\.is-animating[^{}]*\{[^}]*overflow\s*:\s*hidden[^}]*will-change\s*:\s*height/);
assert.doesNotMatch(learnCss, /\.card-body(?:\.is-animating)?[^{}]*\{[^}]*(?:grid-template-rows|opacity|visibility)\s*:/);
assert.match(learnCss, /\.card-body\.hidden[^{}]*\{[^}]*display\s*:\s*none/);
assert.match(learnCss, /\.tree-section-label[^{}]*\{[^}]*border\s*:\s*none[^}]*border-radius\s*:\s*var\(--radius\)/);
assert.doesNotMatch(learnCss, /\.tree-section-label(?::hover|\.active)?[^{}]*\{[^}]*border-color\s*:/);
assert.match(learnCss, /\.tree-section-label\.read[^{}]*\{[^}]*color\s*:\s*var\(--gold-deep\)/);
assert.match(learnCss, /\.tab-set-panel>p[^{}]*\{[^}]*text-indent\s*:\s*2em/);
assert.match(learnCss, /\.course-list[^{}]*\{[^}]*margin-inline\s*:\s*2em 0[^}]*padding-inline-start\s*:\s*1\.25em/);
assert.match(learnCss, /\.course-list li[^{}]*\{[^}]*padding-left\s*:\s*0/);
assert.match(learnCss, /\.app[^{}]*\{[^}]*height\s*:\s*calc\(100vh - var\(--header-h\) - var\(--footer-h\)\)/);
assert.match(learnCss, /\.main[^{}]*\{[^}]*padding-bottom\s*:\s*0/);
assert.match(learnCss, /\.main[^{}]*\{[^}]*scroll-padding-block-start\s*:\s*12px/);
assert.match(learnCss, /\.sidebar[^{}]*\{[^}]*overscroll-behavior-y\s*:\s*contain/);
assert.doesNotMatch(learnCss, /\.main[^{}]*\{[^}]*padding-bottom\s*:\s*calc\([^)]*var\(--footer-h\)/);
assert.match(learnCss, /\.section-quiz[^{}]*\{[^}]*background-color\s*:\s*var\(--paper\)/);
assert.doesNotMatch(learnCss, /\.tree-(?:chapter|subsection|section-label|knowledge-list)[^{}]*\{[^}]*border-(?:left|right)\s*:/);

console.log('sidebar-navigation: ok');
