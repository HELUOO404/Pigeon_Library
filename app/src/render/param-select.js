// param-select.js — paramSelect 块:参数选择答题表(契约见 docs/pigeon-format.md §2.6)。
//   实验(三列平表/二维选择矩阵)与工程(结构→工艺两级合并 + 仿真按钮)统一形态:
//   下拉任意顺序填写 → 全填后统一提交计分;仿真按钮覆盖的参数区间(paramRange)全填后出现
//   (与对错无关,忠实原站),点击展开原站已验证的结果图(images,非交互 sandbox)。
import { escapeHtml } from './utils.js';

const blocks = new Map();
const memoryStates = new Map();   // 访客 store 不持久化(get 恒返回 fallback),练习状态会话内暂存
const openSims = new Map();       // { blockId: Set<simIndex> } 仿真面板开合(会话态)
const STATE_VERSION = 1;

function blockId(block) {
  return String(block.id || '').trim();
}

function normalizeGroups(block) {
  return (Array.isArray(block.groups) ? block.groups : [])
    .map((group) => ({ ...group, params: Array.isArray(group.params) ? group.params : [] }));
}

function normalizeMatrixRows(block) {
  return (Array.isArray(block.matrixRows) ? block.matrixRows : [])
    .map((row) => ({ ...row, cells: Array.isArray(row.cells) ? row.cells : [] }));
}

function matrixCellContent(cell) {
  if (Array.isArray(cell?.content)) return cell.content;
  if (cell?.param) return [{ type: 'control', ...cell.param }];
  if (Object.hasOwn(cell || {}, 'text')) return [{ type: 'text', text: cell.text }];
  return [];
}

/** 参数全局编号(1 起,跨组连续),状态与反馈都按全局号存取。 */
function flatParams(block) {
  const list = [];
  const matrixRows = normalizeMatrixRows(block);
  if (matrixRows.length) {
    matrixRows.forEach((row, rowIndex) => {
      row.cells.forEach((cell, cellIndex) => {
        matrixCellContent(cell).forEach((part, partIndex) => {
          if (part?.type === 'control') list.push({ param: part, rowIndex: rowIndex + 1, cellIndex: cellIndex + 1, partIndex: partIndex + 1 });
        });
      });
    });
    return list;
  }
  normalizeGroups(block).forEach((group, groupIndex) => {
    group.params.forEach((param) => list.push({ param, groupIndex: groupIndex + 1 }));
  });
  return list;
}

function defaultState() {
  return { version: STATE_VERSION, mode: 'practice', selected: {}, submitted: false, score: null };
}

function allStates(store) {
  return store.get('simulations', {});
}

function stateFor(id, store) {
  const stored = allStates(store)[id] || memoryStates.get(id);
  if (!stored || stored.version !== STATE_VERSION) return defaultState();
  return { ...defaultState(), ...stored, selected: { ...(stored.selected || {}) } };
}

function saveState(id, value, store) {
  memoryStates.set(id, value);
  const states = allStates(store);
  states[id] = value;
  store.set('simulations', states);
}

function isCorrect(param, selected) {
  return Number(selected) === Number(param?.answerIndex);
}

function answeredCount(block, state) {
  return flatParams(block).filter((_item, index) => Number(state.selected[index + 1] || 0) > 0).length;
}

function allAnswered(block, state) {
  const total = flatParams(block).length;
  return total > 0 && answeredCount(block, state) === total;
}

/** 该 paramRange 是否已填满(仿真按钮出现条件:填满即可,与对错无关)。区间 1 起,含端点。 */
function rangeFilled(state, range) {
  const [start, end] = range;
  for (let n = start; n <= end; n += 1) {
    if (Number(state.selected[n] || 0) === 0) return false;
  }
  return true;
}

function simulationsOf(block) {
  return Array.isArray(block.simulations) ? block.simulations : [];
}

/** 组的 merged 列值(契约 §2.6):优先 merged 数组;structure/process 是两列形态简写。 */
function mergedOf(group) {
  if (Array.isArray(group.merged)) return group.merged;
  if (group.structure || group.process) return [group.structure || '', group.process || ''];
  return [];
}

function grouped(block) {
  return normalizeGroups(block).some((group) => mergedOf(group).length > 0);
}

/** 每个 merged 列:相邻组同列同文本合并为一个 rowspan 单元(忠实原站 埋层 rowspan=27 跨多个工艺组)。 */
function mergedSpans(groups, columnIndex) {
  const spans = [];
  groups.forEach((group, index) => {
    const value = mergedOf(group)[columnIndex];
    const last = spans[spans.length - 1];
    const isText = typeof value === 'string' && value !== '';
    if (last && isText && last.value === value) {
      last.rows += group.params.length;
    } else {
      spans.push({ value: value ?? '', rows: group.params.length, first: index });
    }
  });
  return spans;
}

function mergedValueHtml(value, course) {
  const images = value && typeof value === 'object'
    ? (Array.isArray(value.images) ? value.images : (value.image ? [value.image] : []))
    : [];
  if (images.length) {
    return `<div class="param-select-merged-images">${images.map((image) => {
      const src = typeof image === 'string' ? image : image?.src;
      const alt = typeof image === 'string' ? '' : image?.alt || '';
      return src ? `<img loading="lazy" src="${escapeHtml(course.resolveAsset(src))}" alt="${escapeHtml(alt)}">` : '';
    }).join('')}</div>`;
  }
  return typeof value === 'string' || typeof value === 'number' ? escapeHtml(String(value)) : '';
}

function mergedCellHtml(value, rows, course) {
  const inner = mergedValueHtml(value, course);
  return `<td rowspan="${rows}">${inner}</td>`;
}

function renderChoiceCell(id, param, number, state) {
  const selected = Number(state.selected[number] || 0);
  if (state.mode === 'answer') {
    return `<p class="param-select-answer">${escapeHtml(param.options?.[Number(param.answerIndex) - 1] || '')}</p>`;
  }
  const correct = isCorrect(param, selected);
  const graded = state.submitted;
  const cls = graded ? (correct ? ' correct' : ' incorrect') : '';
  const feedback = graded && !correct
    ? `<div class="step-simulation-correct-answer"><p>正确答案：${escapeHtml(param.options?.[Number(param.answerIndex) - 1] || '')}</p>${param.explain ? `<p class="step-simulation-explain">${escapeHtml(param.explain)}</p>` : ''}</div>`
    : '';
  return `<select class="step-simulation-choice${cls}" data-action="param-select" data-param-id="${escapeHtml(id)}" data-param="${number}" aria-label="参数 ${number} 选择">
    <option value="">请选择</option>
    ${(param.options || []).map((option, optionIndex) => `<option value="${optionIndex + 1}" ${selected === optionIndex + 1 ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}
  </select>${feedback}`;
}

function tableHeaders(block, mergedCols) {
  const defaultHeaders = mergedCols > 0
    ? ['序号', ...Array.from({ length: mergedCols }, (_v, i) => (mergedCols === 2 ? ['结构', '工艺'][i] : `分组${i + 1}`)), '参数名称', '选择']
    : ['序号', '项目', '选择'];
  return Array.isArray(block.headers) && block.headers.length ? block.headers : defaultHeaders;
}

function renderTable(id, block, course, state) {
  if (normalizeMatrixRows(block).length) return renderMatrixTable(id, block, state);
  const groups = normalizeGroups(block);
  const mergedCols = Math.max(0, ...groups.map((g) => mergedOf(g).length));
  const headers = tableHeaders(block, mergedCols);
  const header = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  // 各 merged 列的 rowspan 起点表:{ 列号 → Map(组号 → span) }
  const spansByColumn = Array.from({ length: mergedCols }, (_v, col) => {
    const map = new Map();
    for (const span of mergedSpans(groups, col)) map.set(span.first, span);
    return map;
  });
  let number = 0;
  const rows = groups.map((group, groupIndex) => group.params.map((param, paramIndex) => {
    number += 1;
    const cells = [`<td class="param-select-number">${number}</td>`];
    if (paramIndex === 0) {
      for (let col = 0; col < mergedCols; col += 1) {
        const span = spansByColumn[col].get(groupIndex);
        if (span) cells.push(mergedCellHtml(span.value, span.rows, course));
      }
    }
    cells.push(`<td class="param-select-label">${escapeHtml(param.label || '')}</td>`);
    cells.push(`<td class="param-select-choice-cell">${renderChoiceCell(id, param, number, state)}</td>`);
    return `<tr>${cells.join('')}</tr>`;
  }).join('')).join('');
  return `<div class="table-scroll param-select-table-wrap"><table class="param-select-table">${header}${rows}</table></div>`;
}

function positiveSpan(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function matrixCellAttrs(cell, tag) {
  const attrs = [];
  if (tag === 'th' && ['row', 'col'].includes(cell?.scope)) attrs.push(`scope="${cell.scope}"`);
  if (positiveSpan(cell?.rowspan) > 1) attrs.push(`rowspan="${positiveSpan(cell.rowspan)}"`);
  if (positiveSpan(cell?.colspan) > 1) attrs.push(`colspan="${positiveSpan(cell.colspan)}"`);
  return attrs.length ? ` ${attrs.join(' ')}` : '';
}

function renderMatrixCellContent(id, cell, state, counter) {
  return matrixCellContent(cell).map((part) => {
    if (part?.type === 'control') {
      counter.value += 1;
      return renderChoiceCell(id, part, counter.value, state);
    }
    return part?.type === 'text' ? escapeHtml(part.text || '') : '';
  }).join('');
}

function sourceMatrixHeader(rows) {
  const row = rows[0];
  return row?.cells?.length && row.cells.every((cell) => cell?.tag === 'th' && cell?.scope === 'col') ? row : null;
}

function matrixHeaderLabel(cell) {
  return matrixCellContent(cell)
    .filter((part) => part?.type === 'text')
    .map((part) => part.text || '')
    .join('');
}

function renderMatrixTable(id, block, state) {
  const headers = Array.isArray(block.headers) ? block.headers : [];
  const rows = normalizeMatrixRows(block);
  const sourceHeader = sourceMatrixHeader(rows);
  const counter = { value: 0 };
  const renderRow = (row) => `<tr>${row.cells.map((cell) => {
    const tag = cell?.tag === 'th' ? 'th' : 'td';
    const hasControl = matrixCellContent(cell).some((part) => part?.type === 'control');
    const className = hasControl ? ' class="param-select-choice-cell"' : '';
    return `<${tag}${matrixCellAttrs(cell, tag)}${className}>${renderMatrixCellContent(id, cell, state, counter)}</${tag}>`;
  }).join('')}</tr>`;
  const header = sourceHeader
    ? `<thead>${renderRow(sourceHeader)}</thead>`
    : (headers.length ? `<thead><tr>${headers.map((value) => `<th scope="col">${escapeHtml(value)}</th>`).join('')}</tr></thead>` : '');
  const body = (sourceHeader ? rows.slice(1) : rows).map(renderRow).join('');
  return `<div class="table-scroll param-select-table-wrap"><table class="param-select-table param-select-matrix-table">${header}<tbody>${body}</tbody></table></div>`;
}

function renderMobileField(label, content, className = '') {
  return `<div class="param-select-mobile-field ${className}"><span class="param-select-mobile-field-label">${escapeHtml(label)}</span><div class="param-select-mobile-field-content">${content}</div></div>`;
}

function renderMobileRows(id, block, course, state) {
  if (normalizeMatrixRows(block).length) return renderMatrixMobileRows(id, block, state);
  const groups = normalizeGroups(block);
  const mergedCols = Math.max(0, ...groups.map((group) => mergedOf(group).length));
  const headers = tableHeaders(block, mergedCols);
  let number = 0;
  const rows = groups.map((group) => {
    const context = Array.from({ length: mergedCols }, (_value, column) => renderMobileField(
      headers[column + 1] || `分组${column + 1}`,
      mergedValueHtml(mergedOf(group)[column], course),
      'param-select-mobile-context',
    )).join('');
    const params = group.params.map((param) => {
      number += 1;
      const fields = [renderMobileField(headers[0] || '序号', String(number), 'param-select-mobile-number')];
      fields.push(renderMobileField(headers[mergedCols + 1] || '参数名称', escapeHtml(param.label || ''), 'param-select-mobile-label'));
      fields.push(renderMobileField(headers[headers.length - 1] || '选择', renderChoiceCell(id, param, number, state), 'param-select-mobile-choice'));
      return `<article class="param-select-mobile-record">${fields.join('')}</article>`;
    }).join('');
    const contextHtml = context ? `<div class="param-select-mobile-group-context">${context}</div>` : '';
    return `<section class="param-select-mobile-group">${contextHtml}<div class="param-select-mobile-params">${params}</div></section>`;
  });
  return `<div class="param-select-mobile">${rows.join('')}</div>`;
}

function renderMatrixMobileRows(id, block, state) {
  const rows = normalizeMatrixRows(block);
  const sourceHeader = sourceMatrixHeader(rows);
  const headers = sourceHeader ? sourceHeader.cells.map(matrixHeaderLabel) : (Array.isArray(block.headers) ? block.headers : []);
  const counter = { value: 0 };
  const records = (sourceHeader ? rows.slice(1) : rows).map((row) => {
    if (headers.length) {
      const fields = row.cells.map((cell, cellIndex) => renderMobileField(
        headers[cellIndex] || '',
        renderMatrixCellContent(id, cell, state, counter),
        matrixCellContent(cell).some((part) => part?.type === 'control') ? 'param-select-mobile-choice' : '',
      ));
      return `<article class="param-select-mobile-record param-select-matrix-mobile-record">${fields.join('')}</article>`;
    }
    const fields = row.cells.map((cell) => {
      const content = renderMatrixCellContent(id, cell, state, counter);
      if (cell?.tag === 'th') return `<h5 class="param-select-matrix-mobile-heading">${content}</h5>`;
      return `<div class="param-select-matrix-mobile-cell">${content}</div>`;
    });
    return `<article class="param-select-mobile-record param-select-matrix-mobile-record param-select-matrix-source-row">${fields.join('')}</article>`;
  }).join('');
  return `<div class="param-select-mobile param-select-matrix-mobile">${records}</div>`;
}

/** 仿真区:paramRange 填满的按钮出现;打开的展开其 images(原站已验证结果图,原样呈现)。 */
function renderSimulations(id, block, course, state) {
  const sims = simulationsOf(block);
  const open = openSims.get(id) || new Set();
  const parts = sims.map((sim, index) => {
    if (!Array.isArray(sim.paramRange) || !rangeFilled(state, sim.paramRange)) return '';
    const isOpen = open.has(index);
    const images = Array.isArray(sim.images) ? sim.images : [];
    const gallery = images.map((image) => {
      const src = typeof image === 'string' ? image : image?.src;
      if (!src) return '';
      const alt = typeof image === 'string' ? sim.label || '' : image.alt || sim.label || '';
      const caption = typeof image === 'string' ? '' : image.caption || '';
      return `<figure class="param-select-sim-figure"><img loading="lazy" src="${escapeHtml(course.resolveAsset(src))}" alt="${escapeHtml(alt)}">${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
    }).join('');
    return `<div class="param-select-sim" data-sim="${index}">
      <button type="button" class="param-select-sim-toggle ${isOpen ? 'open' : ''}" data-action="param-sim-toggle" data-param-id="${escapeHtml(id)}" data-sim="${index}">${escapeHtml(sim.label || '仿真')}</button>
      <div class="param-select-sim-panel" data-sim-panel="${index}" ${isOpen ? '' : 'hidden'}>${isOpen ? gallery : ''}</div>
    </div>`;
  }).filter(Boolean);
  return parts.length ? `<div class="param-select-sims">${parts.join('')}</div>` : '';
}

function renderBlockHtml(block, course, state = defaultState()) {
  const id = blockId(block);
  if (!id) return '';
  const answerMode = state.mode === 'answer';
  const total = flatParams(block).length;
  const percent = state.submitted && Number.isInteger(state.score) && total > 0
    ? Math.round((state.score / total) * 100)
    : null;
  const result = percent !== null && !answerMode
    ? `<p class="step-simulation-result" role="status">得分 ${percent} 分 · 正确率 ${state.score}/${total}</p>`
    : '';
  const progress = answerMode ? '' : `<p class="step-simulation-progress" data-role="param-progress">进度 ${answeredCount(block, state)}/${total}</p>`;
  const controls = answerMode ? '' : `<button type="button" class="step-simulation-command" data-action="param-submit" data-param-id="${escapeHtml(id)}" ${allAnswered(block, state) ? '' : 'disabled'}>提交</button>`;
  return `<div class="param-select" data-param-id="${escapeHtml(id)}">
    <div class="step-simulation-header">
      <div class="step-simulation-heading">
        <p class="step-simulation-eyebrow">参数练习</p>
        <h4>${escapeHtml(block.title || '参数设置')}</h4>
      </div>
      <div class="step-simulation-modes" role="group" aria-label="练习模式">
        <button type="button" class="step-simulation-mode ${answerMode ? '' : 'active'}" data-action="param-mode" data-param-id="${escapeHtml(id)}" data-mode="practice">操作练习</button>
        <button type="button" class="step-simulation-mode ${answerMode ? 'active' : ''}" data-action="param-mode" data-param-id="${escapeHtml(id)}" data-mode="answer">参考答案</button>
      </div>
    </div>
    ${renderTable(id, block, course, state)}
    ${renderMobileRows(id, block, course, state)}
    ${renderSimulations(id, block, course, state)}
    <div class="step-simulation-actions">${progress}${result}${controls}</div>
  </div>`;
}

function replaceBlock(id, store) {
  const entry = blocks.get(id);
  const root = document.querySelector(`.param-select[data-param-id="${CSS.escape(id)}"]`);
  if (!entry || !root) return;
  const activeElement = document.activeElement;
  const active = activeElement?.dataset;
  const focusRepresentation = activeElement?.closest?.('.param-select-mobile') ? '.param-select-mobile' : '.param-select-table-wrap';
  const focusSelector = active?.param && active?.paramId === id ? `[data-param="${CSS.escape(active.param)}"]` : '';
  root.outerHTML = renderBlockHtml(entry.block, entry.course, stateFor(id, store));
  if (focusSelector) {
    document.querySelector(`.param-select[data-param-id="${CSS.escape(id)}"] ${focusRepresentation} ${focusSelector}`)?.focus({ preventScroll: true });
  }
}

export function renderParamSelect(block, course) {
  const id = blockId(block);
  if (!id) return '';
  blocks.set(id, { block, course });
  openSims.delete(id);
  return renderBlockHtml(block, course);
}

export function initParamSelects(store) {
  for (const id of blocks.keys()) replaceBlock(id, store);
}

export function handleParamSelectAction(target, store) {
  const id = target.dataset.paramId;
  const entry = blocks.get(id);
  if (!entry) return false;
  const state = stateFor(id, store);

  if (target.dataset.action === 'param-mode') {
    state.mode = target.dataset.mode === 'answer' ? 'answer' : 'practice';
    saveState(id, state, store);
    replaceBlock(id, store);
    return true;
  }
  if (target.dataset.action === 'param-select') {
    if (state.mode !== 'practice') return true;
    state.selected[Number(target.dataset.param)] = Number(target.value || 0);
    state.submitted = false;
    state.score = null;
    saveState(id, state, store);
    replaceBlock(id, store);   // 重渲染:清对错态 + 组填满后仿真按钮出现
    return true;
  }
  if (target.dataset.action === 'param-submit') {
    if (!allAnswered(entry.block, state)) return true;
    state.submitted = true;
    state.score = flatParams(entry.block).filter((item, index) => isCorrect(item.param, state.selected[index + 1])).length;
    saveState(id, state, store);
    replaceBlock(id, store);
    return true;
  }
  if (target.dataset.action === 'param-sim-toggle') {
    const simIndex = Number(target.dataset.sim);
    const open = openSims.get(id) || new Set();
    if (open.has(simIndex)) open.delete(simIndex);
    else open.add(simIndex);
    openSims.set(id, open);
    replaceBlock(id, store);
    return true;
  }
  return false;
}
