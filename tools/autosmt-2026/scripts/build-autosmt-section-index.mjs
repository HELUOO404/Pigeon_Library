import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const SOURCE = path.join(REPORTS, 'section-metadata');
const OUTPUT = path.join(REPORTS, 'section-activity-index.json');

if (!existsSync(SOURCE)) {
  console.error('Section metadata is missing. Run inspect-scope first.');
  process.exit(1);
}

const sections = readdirSync(SOURCE)
  .filter((name) => /^\d+-\d+\.json$/u.test(name))
  .map((name) => JSON.parse(readFileSync(path.join(SOURCE, name), 'utf8')))
  .sort((left, right) => left.chapterIndex - right.chapterIndex || left.sectionIndex - right.sectionIndex)
  .map((section) => {
    const labels = section.menuLabels || [];
    return {
      chapterIndex: section.chapterIndex,
      sectionIndex: section.sectionIndex,
      labels,
      overview: labels.find((label) => label === '概述') || null,
      theory: labels.find((label) => label === '理论知识') || null,
      lectureVideo: labels.find((label) => label === '讲课视频') || null,
      homework: labels.find((label) => label === '作业') || null,
      experiments: labels.filter((label) => label.startsWith('实验')),
      engineering: labels.filter((label) => label.startsWith('工程')),
    };
  });

const report = {
  schemaVersion: 1,
  source: 'section-metadata',
  capturedSections: sections.length,
  sections,
};
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ sections: report.capturedSections, experiments: sections.flatMap((item) => item.experiments).length, engineering: sections.flatMap((item) => item.engineering).length }));
