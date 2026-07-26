function text(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

function assignment(html, name) {
  const match = html.match(new RegExp(`\\b(?:var|let|const)\\s+${name}\\s*=\\s*'((?:\\\\.|[^'])*)'`));
  if (!match) throw new Error(`process-gnq missing ${name}`);
  return JSON.parse(match[1].replace(/\\'/g, "'"));
}

function sourcePosition(source, row) {
  return `${source}#row-${row}`;
}

function answerFor(selected, group, field, options, label) {
  const matches = selected.filter((item) => (item?.group ?? (item?.field % 2 ? 's1' : 's2')) === group && item?.field === field);
  if (matches.length !== 1) throw new Error(`process-gnq missing unique ${label} answer at field ${field}`);
  const answer = matches[0];
  if (!Number.isInteger(answer.answerIndex) || answer.answerIndex < 1 || answer.answerIndex > options.length) {
    throw new Error(`process-gnq invalid ${label} answer index at field ${field}`);
  }
  if (answer.value !== options[answer.answerIndex - 1]) {
    throw new Error(`process-gnq ${label} answer value mismatch at field ${field}`);
  }
  return answer.answerIndex;
}

function parseRows(html) {
  const table = html.match(/<table\b[^>]*\bid\s*=\s*["']table_gylcsj["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!table) throw new Error('process-gnq missing table_gylcsj');
  const rows = [];
  for (const match of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
      .map((cell) => ({ attrs: cell[1], value: cell[2] }));
    if (!cells.length) continue;
    const number = Number(text(cells[0].value));
    const groupCell = cells.find((cell) => /\bclass\s*=\s*["'][^"']*\bs1\b/i.test(cell.value));
    const processCell = cells.find((cell) => /\bclass\s*=\s*["'][^"']*\bs2\b/i.test(cell.value));
    if (!Number.isInteger(number) || !processCell) throw new Error('process-gnq malformed process row');
    const rowspan = groupCell?.attrs.match(/\browspan\s*=\s*["']?(\d+)/i);
    rows.push({ number, groupStart: Boolean(groupCell), rowspan: groupCell ? Number(rowspan?.[1] ?? 1) : 0 });
  }
  if (!rows.length) throw new Error('process-gnq contains no process rows');
  return rows;
}

function headings(html) {
  const table = html.match(/<table\b[^>]*\bid\s*=\s*["']table_gylcsj["'][^>]*>([\s\S]*?)<\/table>/i)?.[1];
  const cells = table ? [...table.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((cell) => text(cell[1])) : [];
  if (cells.length < 3 || !cells[1] || !cells[2]) throw new Error('process-gnq missing group/process headers');
  return { group: cells[1], process: cells[2] };
}

function mediaFor(media, step) {
  const matches = media.filter((item) => item?.step === step);
  if (matches.length !== 1 || typeof matches[0].clip !== 'string') {
    throw new Error(`process-gnq missing captured media for step ${step}`);
  }
  const item = matches[0];
  if (!item.clip.startsWith('assets/') || (item.poster != null && !item.poster.startsWith('assets/'))) {
    throw new Error(`process-gnq non-local media for step ${step}`);
  }
  return { clip: item.clip, ...(item.poster ? { poster: item.poster } : {}) };
}

export function convertProcessGnq({ id, title, html, verified, source, media }) {
  if (!id || !title || typeof html !== 'string') throw new TypeError('process-gnq requires id, title, and activity HTML');
  if (!/^tools\/autosmt-2026\/reports\/activity-details\/.+-experiment-\d+-tab-\d+\.html$/i.test(source ?? '')) {
    throw new Error('process-gnq requires a 2026 activity HTML source');
  }
  if (verified?.finalScore !== 100 || verified?.verified !== true || !Array.isArray(verified.selected)) {
    throw new Error('process-gnq requires score=100 and verified=true answer evidence');
  }
  if (!Array.isArray(media)) throw new TypeError('process-gnq requires captured media');

  const options = assignment(html, 'jsonstr_select');
  const starts = assignment(html, 'json_gnqsy');
  if (!Array.isArray(options) || options.length !== 2 || options.some((set) => !Array.isArray(set) || !set.length)) {
    throw new Error('process-gnq invalid option sets');
  }
  const rows = parseRows(html);
  const headers = headings(html);
  const groupStarts = rows.filter((row) => row.groupStart);
  if (!Array.isArray(starts) || starts.length !== groupStarts.length || starts.some((start, index) => start !== groupStarts[index].number - 1)) {
    throw new Error('process-gnq group start mapping mismatch');
  }

  let cursor = 0;
  const groups = groupStarts.map((group) => {
    const contained = rows.slice(cursor, cursor + group.rowspan);
    cursor += group.rowspan;
    if (contained.length !== group.rowspan || contained[0]?.number !== group.number) {
      throw new Error(`process-gnq invalid rowspan at row ${group.number}`);
    }
    const groupSource = sourcePosition(source, group.number);
    return {
      prompt: headers.group,
      options: [...options[0]],
      answerIndex: answerFor(verified.selected, 's1', group.number * 2 - 1, options[0], 'group'),
      source: groupSource,
      steps: contained.map((row) => {
        const asset = mediaFor(media, row.number);
        return {
          prompt: headers.process,
          options: [...options[1]],
          answerIndex: answerFor(verified.selected, 's2', row.number * 2, options[1], 'step'),
          ...asset,
          source: sourcePosition(source, row.number),
        };
      }),
    };
  });
  if (cursor !== rows.length) throw new Error('process-gnq unassigned process rows');
  return { type: 'stepSimulation', id, title, groups };
}
