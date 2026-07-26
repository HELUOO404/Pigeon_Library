function hardStop(message) {
  throw new Error(`[HARD STOP] engineering parameter conversion: ${message}`);
}

function decode(text) {
  return String(text)
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|amp|lt|gt|quot|nbsp);/giu, (match, hex, decimal) => {
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
      return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ' }[match.toLowerCase()] ?? match;
    })
    .replace(/<[^>]+>/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function attr(attributes, name) {
  const match = String(attributes).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'iu'));
  return match?.[2] ?? '';
}

function tableCells(rowHtml) {
  return [...rowHtml.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/giu)].map((match) => {
    const images = [...match[3].matchAll(/<img\b([^>]*)>/giu)].map((image) => attr(image[1], 'src')).filter(Boolean);
    const button = /<a\b[^>]*class=(["'])[^"']*\bax-btn\b[^"']*\1[^>]*>/iu.test(match[3]) ? decode(match[3]) : '';
    const rowspanValue = Number.parseInt(attr(match[2], 'rowspan') || '1', 10);
    if (!Number.isInteger(rowspanValue) || rowspanValue < 1) hardStop('invalid table rowspan');
    return {
      text: decode(match[3]),
      images,
      button,
      select: /<select\b/iu.test(match[3]),
      rowspan: rowspanValue,
      tag: match[1].toLowerCase(),
    };
  });
}

function parseTable(html) {
  const table = String(html).match(/<table\b[^>]*>([\s\S]*?)<\/table>/iu);
  if (!table) hardStop('missing parameter table');
  const rawRows = [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/giu)].map((match) => tableCells(match[1]));
  if (rawRows.length < 2 || !rawRows[0].length) hardStop('empty parameter table');
  const headers = rawRows[0].map((cell) => cell.text);
  const columnCount = headers.length;
  const active = Array(columnCount).fill(null);
  const rows = [];
  rawRows.slice(1).forEach((raw, rowIndex) => {
    const logical = Array(columnCount).fill(null);
    for (let column = 0; column < columnCount; column += 1) {
      if (!active[column]) continue;
      logical[column] = active[column].cell;
      active[column].remaining -= 1;
      if (!active[column].remaining) active[column] = null;
    }
    for (const cell of raw) {
      const column = logical.findIndex((value) => value === null);
      if (column < 0) hardStop(`table row ${rowIndex + 2} exceeds header width`);
      logical[column] = cell;
      if (cell.rowspan > 1) active[column] = { cell, remaining: cell.rowspan - 1 };
    }
    if (logical.some((cell) => cell === null)) hardStop(`table row ${rowIndex + 2} has unresolved merged cells`);
    rows.push(logical);
  });
  if (active.some(Boolean)) hardStop('table ends before merged cells');
  return { headers, rows };
}

function scriptOptions(html) {
  const match = String(html).match(/var\s+jsonstr_xx\s*=\s*(['"])((?:\\.|(?!\1)[\s\S])*)\1/iu);
  if (!match) hardStop('missing jsonstr_xx options');
  let source;
  try {
    source = JSON.parse(match[2].replace(/\\\//gu, '/'));
  } catch (error) {
    hardStop(`invalid jsonstr_xx: ${error.message}`);
  }
  if (!Array.isArray(source) || !source.length) hardStop('empty jsonstr_xx options');
  return source.map((value, index) => {
    if (typeof value !== 'string' || !value) hardStop(`invalid options at select ${index + 1}`);
    const options = value.split(';').filter(Boolean);
    if (!options.length) hardStop(`empty option list at select ${index + 1}`);
    return options;
  });
}

function sourceRecord(target, kind, sourceFile, sourceLocation, value) {
  return { target, kind, sourceFile, sourceLocation, value };
}

function checkedAnswers(evidence, scoreNumber, optionLists) {
  if (evidence?.scoreType !== 'engineering' || evidence?.scoreNumber !== scoreNumber || Number(evidence?.score) !== 100) {
    hardStop(`engineering ${scoreNumber} has no full-score evidence`);
  }
  const tabs = evidence.tabs;
  if (!Array.isArray(tabs) || tabs.length !== 1 || tabs[0]?.subIndex !== 0 || tabs[0]?.kind !== 'select') {
    hardStop(`engineering ${scoreNumber} has ambiguous full-score tabs`);
  }
  const values = tabs[0].selectedValues;
  if (!Array.isArray(values) || values.length !== optionLists.length || tabs[0].selectedCount !== values.length || tabs[0].emptyCount !== 0) {
    hardStop(`engineering ${scoreNumber} full-score answer count mismatch`);
  }
  return values.map((value, index) => {
    const answerIndex = optionLists[index].indexOf(value) + 1;
    if (!answerIndex) hardStop(`engineering ${scoreNumber} full-score answer ${index + 1} is not a source option`);
    return answerIndex;
  });
}

function imageCell(cell, staticCapture, resolveImage, sourceFile, location) {
  const images = cell.images.map((reference) => {
    const captured = staticCapture?.[reference];
    if (!captured || !captured.file || !captured.sha256 || !Number.isInteger(captured.bytes) || captured.bytes <= 0 || !/^image\//u.test(captured.contentType || '')) {
      hardStop(`missing captured static image ${reference}`);
    }
    if (!Array.isArray(captured.sourcePages) || !captured.sourcePages.includes(`activity-details/${sourceFile}`)) {
      hardStop(`static image ${reference} is not captured from ${sourceFile}`);
    }
    const resolved = resolveImage(captured);
    if (typeof resolved !== 'string' || !resolved || /^(?:https?:)?\/\//iu.test(resolved)) hardStop(`image ${reference} did not resolve locally`);
    return { src: resolved, alt: '' };
  });
  if (!images.length) return cell.text;
  return { ...(cell.text ? { text: cell.text } : {}), images };
}

function compactGroups(rows, mergedColumns, optionLists, answers, staticCapture, resolveImage, sourceFile, evidenceFile, ledger) {
  const groups = [];
  let selectIndex = 0;
  for (const [rowIndex, row] of rows.entries()) {
    if (!row.some((cell) => cell.select)) continue;
    const selectColumn = row.findIndex((cell) => cell.select);
    const parameterCell = row[selectColumn - 1];
    if (selectColumn < 1 || !parameterCell?.text) hardStop(`parameter row ${rowIndex + 1} has no label`);
    const options = optionLists[selectIndex];
    const answerIndex = answers[selectIndex];
    if (!options || !answerIndex) hardStop(`missing source options or answer for parameter ${selectIndex + 1}`);
    const merged = mergedColumns.map((column) => imageCell(row[column], staticCapture, resolveImage, sourceFile, `table/tr[${rowIndex + 2}]/td[${column + 1}]`));
    const key = JSON.stringify(merged);
    let group = groups.at(-1);
    if (!group || group.key !== key) {
      group = { key, merged, params: [] };
      groups.push(group);
      const groupIndex = groups.length - 1;
      for (const column of mergedColumns) {
        if (!row[column].images.length) continue;
        ledger.push(sourceRecord(
          `paramSelect/groups/${groupIndex}/merged/${mergedColumns.indexOf(column)}`,
          'static-image',
          sourceFile,
          `table/tr[${rowIndex + 2}]/td[${column + 1}]/img`,
          row[column].images,
        ));
      }
    }
    group.params.push({ label: parameterCell.text, options, answerIndex });
    const target = `paramSelect/groups/${groups.length - 1}/params/${group.params.length - 1}`;
    ledger.push(
      sourceRecord(`${target}/label`, 'parameter-label', sourceFile, `table/tr[${rowIndex + 2}]/td[${selectColumn}]`, parameterCell.text),
      sourceRecord(`${target}/options`, 'parameter-options', sourceFile, `script:jsonstr_xx[${selectIndex}]`, options),
      sourceRecord(`${target}/answerIndex`, 'parameter-answer', evidenceFile, `tabs[0].selectedValues[${selectIndex}]`, answerIndex),
    );
    selectIndex += 1;
  }
  if (selectIndex !== optionLists.length) hardStop(`table/select count ${selectIndex} does not match source options ${optionLists.length}`);
  return groups.map(({ key, ...group }) => group);
}

function capturedSimulation(simulationCapture, scoreNumber, buttonIndex, sourceFile, resolveImage) {
  const item = simulationCapture?.[`engineering:${scoreNumber}:0:${buttonIndex}`];
  if (!item || item.status !== 'captured' || item.target?.rawHtmlFile !== sourceFile || item.target?.scoreNumber !== scoreNumber || item.step !== buttonIndex || !Array.isArray(item.captured) || !item.captured.length) {
    hardStop(`missing captured result image for engineering ${scoreNumber} button ${buttonIndex}`);
  }
  const images = item.captured.map((captured) => {
    if (!captured.file || !captured.sha256) hardStop(`invalid captured result image for engineering ${scoreNumber} button ${buttonIndex}`);
    const resolved = resolveImage(captured);
    if (typeof resolved !== 'string' || !resolved || /^(?:https?:)?\/\//iu.test(resolved)) hardStop(`result image did not resolve locally`);
    return resolved;
  });
  return { item, images };
}

function simulationsFor(rows, scoreNumber, simulationCapture, sourceFile, resolveImage, ledger) {
  const result = [];
  let buttonIndex = 0;
  for (const [rowIndex, row] of rows.entries()) {
    const buttonCell = row.find((cell) => cell.button);
    if (!buttonCell) continue;
    if (rowIndex > 0 && rows[rowIndex - 1].includes(buttonCell)) continue;
    const startRow = rowIndex;
    const endRow = rowIndex + buttonCell.rowspan - 1;
    const before = rows.slice(0, startRow).filter((candidate) => candidate.some((cell) => cell.select)).length;
    const within = rows.slice(startRow, endRow + 1).filter((candidate) => candidate.some((cell) => cell.select)).length;
    if (!within) hardStop(`engineering ${scoreNumber} button ${buttonIndex} has no answerable parameter range`);
    const { item, images } = capturedSimulation(simulationCapture, scoreNumber, buttonIndex, sourceFile, resolveImage);
    result.push({ label: buttonCell.button, paramRange: [before + 1, before + within], images });
    ledger.push(
      sourceRecord(`paramSelect/simulations/${buttonIndex}/label`, 'simulation-button', sourceFile, `table/tr[${rowIndex + 2}]`, buttonCell.button),
      sourceRecord(`paramSelect/simulations/${buttonIndex}/paramRange`, 'simulation-rowspan-range', sourceFile, `table/tr[${rowIndex + 2}]/td[rowspan=${buttonCell.rowspan}]`, [before + 1, before + within]),
      sourceRecord(`paramSelect/simulations/${buttonIndex}/images`, 'simulation-result-images', 'engineering-simulation-capture-v1.json', `steps[engineering:${scoreNumber}:0:${buttonIndex}]`, { source: item.captured, resolved: images }),
    );
    buttonIndex += 1;
  }
  const capturedCount = Object.keys(simulationCapture || {}).filter((key) => key.startsWith(`engineering:${scoreNumber}:0:`)).length;
  if (buttonIndex !== capturedCount) hardStop(`engineering ${scoreNumber} button count ${buttonIndex} does not match capture ${capturedCount}`);
  return result;
}

function fixedValueTable(headers, rows, staticCapture, resolveImage, sourceFile, ledger) {
  const staticRows = rows.filter((row) => !row.some((cell) => cell.select));
  if (!staticRows.length) return null;
  const omitSimulation = /仿真/u.test(headers.at(-1));
  const displayHeaders = omitSimulation ? headers.slice(0, -1) : headers;
  const width = displayHeaders.length;
  const resultRows = staticRows.map((row, index) => {
    const output = row.slice(0, width).map((cell, column) => imageCell(cell, staticCapture, resolveImage, sourceFile, `table/static[${index + 1}]/td[${column + 1}]`));
    ledger.push(sourceRecord(`paramsTable/rows/${index}`, 'fixed-parameter-row', sourceFile, `table/static-row[${index + 1}]`, output));
    return output;
  });
  return { type: 'paramsTable', headers: displayHeaders, rows: resultRows };
}

export function convertEngineeringParams({
  activity,
  html,
  evidence,
  simulationCapture,
  staticCapture,
  sourceFile,
  evidenceFile,
  simulationEvidenceFile,
  staticEvidenceFile,
  resolveImage,
}) {
  const scoreNumber = activity?.scoreNumber;
  if (!Number.isInteger(scoreNumber) || activity?.scoreType !== 'engineering' || activity?.subIndex !== 0 || activity?.kind !== 'select') hardStop('activity metadata is not an engineering select tab');
  if (!sourceFile || activity.rawHtmlFile !== sourceFile || typeof resolveImage !== 'function') hardStop(`invalid source contract for engineering ${scoreNumber}`);
  const { headers, rows } = parseTable(html);
  const optionLists = scriptOptions(html);
  const answerIndices = checkedAnswers(evidence, scoreNumber, optionLists);
  const selectCount = rows.filter((row) => row.some((cell) => cell.select)).length;
  if (selectCount !== optionLists.length || selectCount !== evidence.tabs[0].controlCount) hardStop(`engineering ${scoreNumber} select count mismatch`);
  const title = decode((String(html).match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/iu) || [])[1] || '');
  if (!title) hardStop(`engineering ${scoreNumber} missing title`);
  const simulationColumn = /仿真/u.test(headers.at(-1));
  const mergedColumns = simulationColumn ? headers.slice(1, -3).map((_, index) => index + 1) : headers.slice(1, -2).map((_, index) => index + 1);
  if (!mergedColumns.length) hardStop(`engineering ${scoreNumber} has no merged context columns`);
  const ledger = [sourceRecord('blocks/0/text', 'activity-heading', sourceFile, 'h3[1]', title)];
  const groups = compactGroups(rows, mergedColumns, optionLists, answerIndices, staticCapture, resolveImage, sourceFile, evidenceFile, ledger);
  const simulations = simulationColumn ? simulationsFor(rows, scoreNumber, simulationCapture, sourceFile, resolveImage, ledger) : [];
  const fixedTable = fixedValueTable(headers, rows, staticCapture, resolveImage, sourceFile, ledger);
  const paramHeaders = simulationColumn ? headers.slice(0, -1) : headers;
  const blocks = [{ type: 'heading', text: title }];
  if (fixedTable) blocks.push(fixedTable);
  blocks.push({ type: 'paramSelect', id: `engineering-${scoreNumber}-0-params`, title, headers: paramHeaders, groups, simulations });
  return {
    id: `engineering-${scoreNumber}-0-params`,
    blocks,
    sourceLedger: ledger,
    audit: {
      scoreNumber,
      sourceFile,
      evidenceFile,
      simulationEvidenceFile,
      staticEvidenceFile,
      selectCount,
      fixedValueRows: fixedTable?.rows.length ?? 0,
      goldReference: {
        presentation: 'autosmt-oxidation-golden',
        structure: 'ic-packaging.pigeon',
        matched: ['native heading', 'native paramSelect', 'native paramsTable when fixed rows exist', 'captured local images'],
        differences: fixedTable ? ['engineering 2 fixed values are split into paramsTable because they are not answerable controls'] : [],
      },
    },
  };
}
