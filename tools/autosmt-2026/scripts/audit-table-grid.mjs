#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require(path.resolve('app/node_modules/node-html-parser'));

const file = process.argv[2];
const needle = process.argv[3];
if (!file || !needle || process.argv.length !== 4) {
  throw new Error('Usage: node tools/autosmt-2026/scripts/audit-table-grid.mjs <html> <image-name>');
}

const bytes = readFileSync(file);
const utf8 = new TextDecoder('utf-8', { fatal: true });
const sourceText = (() => {
  try { return utf8.decode(bytes); } catch { return new TextDecoder('gb18030').decode(bytes); }
})();
const root = parse(sourceText);
const table = root.querySelectorAll('table').find((candidate) => candidate.innerHTML.includes(needle));
if (!table) throw new Error(`No table contains ${needle}`);

const grid = [];
const cells = [];
for (const [rowIndex, row] of table.querySelectorAll('tr').entries()) {
  grid[rowIndex] ??= [];
  let colIndex = 0;
  for (const cell of row.childNodes.filter((child) => ['td', 'th'].includes(child.tagName?.toLowerCase()))) {
    while (grid[rowIndex][colIndex] !== undefined) colIndex += 1;
    const rowspan = Number(cell.getAttribute('rowspan') || 1);
    const colspan = Number(cell.getAttribute('colspan') || 1);
    const id = `r${rowIndex}c${colIndex}`;
    const record = {
      id,
      physicalRow: rowIndex,
      logicalColumn: colIndex,
      tag: cell.tagName.toLowerCase(),
      rowspan,
      colspan,
      text: cell.textContent.replace(/\\s+/g, ' ').trim(),
      images: cell.querySelectorAll('img').map((image) => image.getAttribute('src') || ''),
    };
    cells.push(record);
    for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
      grid[r] ??= [];
      for (let c = colIndex; c < colIndex + colspan; c += 1) grid[r][c] = id;
    }
    colIndex += colspan;
  }
}

console.log(JSON.stringify({
  source: path.resolve(file),
  needle,
  logicalColumnCount: Math.max(...grid.map((row) => row.length)),
  cells,
  logicalGrid: grid,
}, null, 2));
