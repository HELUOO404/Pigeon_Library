import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKBENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORTS = path.join(WORKBENCH, 'reports');
const DETAILS = path.join(REPORTS, 'activity-details');

function readJson(name) {
  return JSON.parse(readFileSync(path.join(REPORTS, name), 'utf8'));
}

const scope = readJson('included-activity-scope.json');
const sectionIndex = readJson('section-activity-index.json');
const progress = readJson('activity-detail-progress.json');
const inventory = readJson('activity-resource-inventory.json');
const failures = [];
const warnings = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function activityKey(type, number) {
  return `${type}:${Number(number)}`;
}

const expected = new Map();
for (const number of scope.included.experiments || []) expected.set(activityKey('experiment', number), null);
for (const number of scope.included.projects || []) expected.set(activityKey('engineering', number), null);
check(expected.size === 49, `Expected 49 included activities, found ${expected.size} in scope.`);

const menuActivities = new Map();
for (const section of sectionIndex.sections || []) {
  for (const label of [...(section.experiments || []), ...(section.engineering || [])]) {
    const match = label.match(/^(实验|工程)(\d+):/);
    if (!match) {
      failures.push(`Unparseable activity label in section index: ${label}`);
      continue;
    }
    const key = activityKey(match[1] === '实验' ? 'experiment' : 'engineering', match[2]);
    if (menuActivities.has(key)) failures.push(`Duplicate activity in section index: ${key}`);
    menuActivities.set(key, { label, chapterIndex: section.chapterIndex, sectionIndex: section.sectionIndex });
  }
}
for (const key of expected.keys()) check(menuActivities.has(key), `Included activity missing from section index: ${key}`);
for (const key of menuActivities.keys()) check(expected.has(key), `Out-of-scope activity present in section index capture: ${key}`);

const jsonFiles = readdirSync(DETAILS).filter((name) => name.endsWith('.json')).sort();
const htmlFiles = readdirSync(DETAILS).filter((name) => name.endsWith('.html')).sort();
check(jsonFiles.length === 80, `Expected 80 detail metadata files, found ${jsonFiles.length}.`);
check(htmlFiles.length === 80, `Expected 80 raw HTML files, found ${htmlFiles.length}.`);

const groups = new Map();
const detailKeys = new Set();
let answerBearingPages = 0;
for (const file of jsonFiles) {
  let metadata;
  try {
    metadata = JSON.parse(readFileSync(path.join(DETAILS, file), 'utf8'));
  } catch (error) {
    failures.push(`Invalid JSON ${file}: ${error.message}`);
    continue;
  }
  const key = activityKey(metadata.scoreType, metadata.scoreNumber);
  const detailKey = `${key}:${metadata.subIndex}`;
  const htmlPath = path.join(DETAILS, metadata.rawHtmlFile || '');
  check(expected.has(key), `Detail page is outside included scope: ${detailKey}`);
  check(metadata.source === 'activity-subitem-page', `Unexpected source for ${detailKey}: ${metadata.source}`);
  check(Number.isInteger(metadata.subIndex) && metadata.subIndex >= 0, `Invalid subIndex for ${detailKey}`);
  check(typeof metadata.label === 'string' && metadata.label.trim(), `Missing tab label for ${detailKey}`);
  check(existsSync(htmlPath) && statSync(htmlPath).size > 0, `Missing or empty raw HTML for ${detailKey}: ${metadata.rawHtmlFile}`);
  check(!detailKeys.has(detailKey), `Duplicate detail key: ${detailKey}`);
  detailKeys.add(detailKey);
  if (metadata.kind === 'select' || metadata.kind === 'process-gnq') answerBearingPages += 1;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(metadata);
}

for (const key of expected.keys()) {
  const tabs = (groups.get(key) || []).sort((a, b) => a.subIndex - b.subIndex);
  check(tabs.length > 0, `Included activity has no detail tabs: ${key}`);
  tabs.forEach((tab, index) => check(tab.subIndex === index, `Non-contiguous tabs for ${key}: expected ${index}, found ${tab.subIndex}`));
  const menu = menuActivities.get(key);
  tabs.forEach((tab) => {
    check(tab.chapterIndex === menu?.chapterIndex && tab.sectionIndex === menu?.sectionIndex,
      `Section mismatch for ${key}:${tab.subIndex}`);
  });
}

check((groups.get('experiment:1') || []).length === 4, 'Experiment 1 must contain four captured tabs.');
check((groups.get('experiment:9') || []).length === 2, 'Experiment 9 must contain two captured tabs.');
const experiment9 = (groups.get('experiment:9') || []).sort((a, b) => a.subIndex - b.subIndex);
check(experiment9[0]?.selectCount === 0 && experiment9[1]?.selectCount > 0,
  'Experiment 9 must preserve the non-question first tab and answer-bearing second tab.');
check(answerBearingPages === 62, `Expected 62 answer-bearing pages, found ${answerBearingPages}.`);

const progressKeys = new Set(progress.completed || []);
for (const key of detailKeys) check(progressKeys.has(key), `Captured detail missing from progress checkpoint: ${key}`);
for (const key of progressKeys) check(detailKeys.has(key), `Progress checkpoint has no matching captured detail: ${key}`);
check((progress.remaining || []).length === 0, `Activity detail progress still has ${progress.remaining.length} remaining entries.`);

check(inventory.pageCount === 80, `Resource inventory must cover 80 pages, found ${inventory.pageCount}.`);
check(inventory.activityCount === 49, `Resource inventory must cover 49 activities, found ${inventory.activityCount}.`);
const inventoryKeys = new Set((inventory.pages || []).map((page) => page.key));
for (const key of detailKeys) check(inventoryKeys.has(key), `Detail page missing from resource inventory: ${key}`);
for (const page of inventory.pages || []) {
  check(page.htmlBytes > 0, `Resource inventory points to empty HTML: ${page.key}`);
  if (page.requiresDynamicMediaCapture && !page.dynamicMedia?.length) {
    failures.push(`Dynamic-media page lacks endpoint evidence: ${page.key}`);
  }
}
if (inventory.dynamicMediaPageCount > 0) {
  warnings.push(`${inventory.dynamicMediaPageCount} page(s) use dynamic video endpoints; clip IDs and files remain gated on verified answers.`);
}

const result = {
  ok: failures.length === 0,
  activities: groups.size,
  detailPages: detailKeys.size,
  answerBearingPages,
  resourceReferences: inventory.resourceReferenceCount,
  dynamicMediaPages: inventory.dynamicMediaPageCount,
  failures,
  warnings,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exitCode = 1;
