// content-renderer.js — 知识点正文渲染:类型化块(段落/表格/小结/对比/小测/图片/html/sandbox)→ HTML;
//   知识点的"已阅读/已掌握"状态与徽章更新也在此。html 块先按静态白名单消毒,再解析相对资源路径;
//   sandbox 块装进隔离 iframe(允许 JS,与主站隔离)。
import { icon } from '../core/icons.js';
import { escapeHtml, getSections, renderSpans, sectionDomId, textFromSpans } from './utils.js';
import { renderStepSimulation } from './step-simulation.js';
import { renderParamSelect } from './param-select.js';

/**
 * sandbox 块里的相对资源路径(assets/...)在运行时并不存在,需解析成解包后的 Blob URL。
 * sandbox 自身已由 iframe 隔离;主文档中的 legacy html 则走下方 DOM 白名单 sanitizer。
 */
function resolveHtmlAssets(html, course) {
  if (!html || !course?.resolveAsset) return html || '';
  const resolve = (value) => {
    if (!value || /^(?:https?:|blob:|data:|mailto:|tel:|javascript:|#|\/)/i.test(value)) return value;
    return course.resolveAsset(value);
  };
  return html
    .replace(/\b(src|poster|data|href)=(["'])(.*?)\2/gi, (whole, attribute, quote, value) => {
      const resolved = resolve(value);
      return resolved === value ? whole : `${attribute}=${quote}${escapeHtml(resolved)}${quote}`;
    })
    .replace(/\bsrcset=(["'])(.*?)\1/gi, (whole, quote, value) => {
      if (/^data:/i.test(value.trim())) return whole;
      const resolved = value.split(',').map((candidate) => {
        const match = candidate.trim().match(/^(\S+)(\s+.+)?$/);
        return match ? `${resolve(match[1])}${match[2] || ''}` : candidate;
      }).join(', ');
      return `srcset=${quote}${escapeHtml(resolved)}${quote}`;
    })
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (whole, quote, value) => {
      const resolved = resolve(value.trim());
      return resolved === value.trim() ? whole : `url(${quote}${escapeHtml(resolved)}${quote})`;
    });
}

/**
 * sandbox 块:把含 JS 逻辑的 HTML 片段装进隔离 iframe(sandbox="allow-scripts",不获 same-origin)。
 * 与主站完全隔离 —— 沙箱内读不到父页 DOM / localStorage / 登录 cookie / 学习进度,也改不了主站状态。
 * 设计令牌跨文档不可见,故组装 srcdoc 时把白名单令牌快照注入 :root,并内置引导脚本:
 *   load 后向父页发 pigeon-theme-request 握手,收到 pigeon-theme 消息时更新 :root(主题切换跟随,
 *   见 main-learn.js 的 message 监听与广播)。
 * srcdoc 末尾注入高度上报脚本:load 与内容尺寸变化时 postMessage;学习页据 contentWindow 比对来源后调高度
 * (见 main-learn.js 的 message 监听)。escapeHtml 不转义引号,故 srcdoc 属性用 escapeAttr 转义。
 */
function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const LEGACY_ALLOWED_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'span', 'strong', 'b',
  'em', 'i', 'u', 's', 'small', 'mark', 'sub', 'sup', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption',
  'table', 'caption', 'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'img', 'video', 'source', 'track',
]);
const LEGACY_DROP_TAGS = new Set([
  'script', 'style', 'link', 'iframe', 'object', 'embed', 'form', 'input',
  'button', 'select', 'option', 'textarea', 'meta', 'base', 'noscript',
  'template', 'svg', 'math', 'canvas', 'audio',
]);
const LEGACY_GLOBAL_ATTRIBUTES = new Set(['class', 'title', 'lang', 'dir']);
const LEGACY_TAG_ATTRIBUTES = {
  td: new Set(['rowspan', 'colspan', 'scope']),
  th: new Set(['rowspan', 'colspan', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'reversed']),
  li: new Set(['value']),
  img: new Set(['src', 'alt', 'loading', 'decoding', 'width', 'height']),
  video: new Set(['src', 'poster', 'controls', 'playsinline', 'preload', 'width', 'height']),
  source: new Set(['src', 'type']),
  track: new Set(['src', 'kind', 'label', 'srclang', 'default']),
};
const LEGACY_SAFE_CLASSES = {
  table: new Set(['params-table', 'compare-table']),
  td: new Set(['compare-label']),
  th: new Set(['compare-label']),
};
const LEGACY_URL_ATTRIBUTES = new Set(['src', 'poster']);
const LEGACY_BOOLEAN_ATTRIBUTES = new Set(['controls', 'playsinline', 'default', 'reversed']);

function legacyAttributeNames(element) {
  if (typeof element.getAttributeNames === 'function') return element.getAttributeNames();
  return Object.keys(element.attributes || {});
}

function removeLegacyNode(node) {
  if (typeof node.remove === 'function') node.remove();
  else node.parentNode?.removeChild?.(node);
}

function unwrapLegacyElement(element) {
  const children = [...(element.childNodes || [])];
  if (typeof element.replaceWith === 'function') element.replaceWith(...children);
  else {
    for (const child of children) element.parentNode?.insertBefore?.(child, element);
    removeLegacyNode(element);
  }
}

function isSafeLegacyUrl(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  const canonical = trimmed.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
  const scheme = canonical.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!scheme) return true;
  if (scheme === 'http' || scheme === 'https' || scheme === 'blob') return true;
  return scheme === 'data' && /^data:image\/(?:png|gif|jpe?g|webp);base64,/i.test(canonical);
}

function resolveLegacyUrl(value, course) {
  const trimmed = String(value || '').trim();
  if (!isSafeLegacyUrl(trimmed)) return '';
  const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(trimmed);
  const resolved = absolute || !course?.resolveAsset ? trimmed : course.resolveAsset(trimmed);
  return isSafeLegacyUrl(resolved) ? String(resolved) : '';
}

function sanitizeLegacyAttribute(element, tag, name, course) {
  const allowed = LEGACY_GLOBAL_ATTRIBUTES.has(name) || LEGACY_TAG_ATTRIBUTES[tag]?.has(name);
  if (!allowed || name === 'style' || name.startsWith('on')) {
    element.removeAttribute(name);
    return;
  }
  const value = element.getAttribute(name) ?? '';
  if (name === 'class') {
    const safe = String(value).split(/\s+/).filter((token) => LEGACY_SAFE_CLASSES[tag]?.has(token));
    if (safe.length) element.setAttribute(name, [...new Set(safe)].join(' '));
    else element.removeAttribute(name);
    return;
  }
  if (LEGACY_URL_ATTRIBUTES.has(name)) {
    const resolved = resolveLegacyUrl(value, course);
    if (resolved) element.setAttribute(name, resolved);
    else element.removeAttribute(name);
    return;
  }
  if (LEGACY_BOOLEAN_ATTRIBUTES.has(name)) {
    element.setAttribute(name, '');
    return;
  }
  if (['rowspan', 'colspan', 'span', 'start', 'value', 'width', 'height'].includes(name)
    && !/^[1-9]\d{0,3}$/.test(String(value))) {
    element.removeAttribute(name);
    return;
  }
  if (name === 'scope' && !['row', 'col', 'rowgroup', 'colgroup'].includes(value)) element.removeAttribute(name);
  else if (name === 'dir' && !['ltr', 'rtl', 'auto'].includes(value)) element.removeAttribute(name);
  else if (name === 'loading' && !['lazy', 'eager'].includes(value)) element.removeAttribute(name);
  else if (name === 'decoding' && !['async', 'sync', 'auto'].includes(value)) element.removeAttribute(name);
  else if (name === 'preload' && !['none', 'metadata', 'auto', ''].includes(value)) element.removeAttribute(name);
  else if (name === 'kind' && !['subtitles', 'captions', 'descriptions', 'chapters', 'metadata'].includes(value)) element.removeAttribute(name);
}

function sanitizeLegacyChildren(root, course) {
  for (const node of [...(root.childNodes || [])]) {
    if (node.nodeType === 8) {
      removeLegacyNode(node);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const tag = String(node.tagName || node.rawTagName || '').toLowerCase();
    if (LEGACY_DROP_TAGS.has(tag)) {
      removeLegacyNode(node);
      continue;
    }
    if (!LEGACY_ALLOWED_TAGS.has(tag)) {
      sanitizeLegacyChildren(node, course);
      unwrapLegacyElement(node);
      continue;
    }
    for (const name of legacyAttributeNames(node)) sanitizeLegacyAttribute(node, tag, name.toLowerCase(), course);
    sanitizeLegacyChildren(node, course);
  }
}

export function sanitizeLegacyHtml(html, course, dom = globalThis.document) {
  const template = dom?.createElement?.('template');
  if (!template || !('content' in template)) return '';
  template.innerHTML = String(html || '');
  sanitizeLegacyChildren(template.content, course);
  return template.innerHTML;
}

/** sandbox 内可用的令牌白名单(契约见 docs/pigeon-format.md §2.5);快照当前主题的计算值。 */
const SANDBOX_TOKENS = ['--paper', '--surface', '--card', '--ink', '--text', '--text-soft',
  '--line', '--line-2', '--gold', '--gold-deep', '--seal', '--hover', '--serif', '--sans', '--mono',
  '--radius', '--correct-bg', '--correct-tx', '--wrong-bg', '--wrong-tx'];

export function sandboxTokenSnapshot() {
  const style = getComputedStyle(document.documentElement);
  const tokens = {};
  for (const name of SANDBOX_TOKENS) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return tokens;
}

function tokensToCss(tokens) {
  return `:root{${Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(';')}}`;
}

const SANDBOX_REPORTER = `(function(){
  var restoring=false;
  var interacted=false;
  function post(message){try{parent.postMessage(message,'*')}catch(e){}}
  function reportHeight(){post({pigeonHeight:document.documentElement.scrollHeight})}
  function controls(){return Array.prototype.map.call(document.querySelectorAll('input,select,textarea'),function(element,index){
    var type=String(element.type||'').toLowerCase();
    if(type==='file'||type==='password')return null;
    var value=element.tagName==='SELECT'&&element.multiple
      ? Array.prototype.filter.call(element.options,function(option){return option.selected}).map(function(option){return option.value})
      : element.value;
    return {index:index,value:value,checked:typeof element.checked==='boolean'?element.checked:null};
  }).filter(Boolean)}
  function reportState(){if(!restoring)post({type:'pigeon-sandbox-state',controls:controls()})}
  function restore(items){
    if(interacted)return;
    restoring=true;
    var elements=document.querySelectorAll('input,select,textarea');
    var changed=[];
    (items||[]).forEach(function(item){
      var element=elements[item.index];
      if(!element)return;
      if(Array.isArray(item.value)&&element.tagName==='SELECT'&&element.multiple){
        Array.prototype.forEach.call(element.options,function(option){option.selected=item.value.indexOf(option.value)>=0});
      }else if(item.value!=null){element.value=String(item.value)}
      if(typeof item.checked==='boolean')element.checked=item.checked;
      changed.push(element);
    });
    changed.forEach(function(element){element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}))});
    restoring=false;
    reportHeight();
  }
  addEventListener('load',function(){reportHeight();post({type:'pigeon-sandbox-ready'})});
  if(window.ResizeObserver)new ResizeObserver(reportHeight).observe(document.documentElement);else addEventListener('resize',reportHeight);
  document.addEventListener('input',function(){if(!restoring)interacted=true;reportState()},true);
  document.addEventListener('change',function(){if(!restoring)interacted=true;reportState()},true);
  document.addEventListener('click',function(){if(!restoring)interacted=true;setTimeout(reportState,0)},true);
  addEventListener('message',function(event){
    if(event.source!==parent||!event.data)return;
    if(event.data.type==='pigeon-theme'&&event.data.tokens){for(var key in event.data.tokens)document.documentElement.style.setProperty(key,event.data.tokens[key]);return}
    if(event.data.type==='pigeon-sandbox-restore'){restore(event.data.controls);return}
    if(event.data.type==='pigeon-sandbox-layout')reportHeight();
  });
  reportHeight();
  post({type:'pigeon-theme-request'});
  post({type:'pigeon-sandbox-ready'});
}())`;

function sandboxKey(block) {
  const explicit = String(block.id || '').trim();
  if (explicit) return `sandbox:${explicit}`;
  const source = JSON.stringify([block.html || '', block.dependencies || []]);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `sandbox:auto-${(hash >>> 0).toString(36)}`;
}

function renderSandbox(block, course) {
  const inner = resolveHtmlAssets(block.html || '', course);
  const height = Number(block.height) > 0 ? Math.floor(Number(block.height)) : 320;
  const hasModeSwitch = block.modeSwitch === true;
  const srcdoc = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<style>${tokensToCss(sandboxTokenSnapshot())}</style>`
    + '<style>html,body{margin:0;padding:10px;font-family:var(--sans,system-ui,-apple-system,"Noto Sans SC",sans-serif);line-height:1.6}*{box-sizing:border-box}</style>'
    + `<body>${inner}<script>${SANDBOX_REPORTER}<\/script>`;
  const modeSwitch = hasModeSwitch ? `
    <div class="sandbox-mode-toolbar">
      <div class="step-simulation-modes" role="group" aria-label="仿真模式">
        <button type="button" class="step-simulation-mode active" data-action="switch-sandbox-mode" data-mode="practice" aria-pressed="true">操作练习</button>
        <button type="button" class="step-simulation-mode" data-action="switch-sandbox-mode" data-mode="answer" aria-pressed="false">参考答案</button>
      </div>
    </div>` : '';
  // wrapper 同时承载站点模式控件与 pigeon-score 分数 chip,并据 contentWindow 精确关联 iframe。
  return `<div class="sandbox-wrapper" data-sandbox-key="${escapeAttr(sandboxKey(block))}"${hasModeSwitch ? ' data-sandbox-mode="practice"' : ''}>${modeSwitch}<iframe class="sandbox-frame" sandbox="allow-scripts" loading="lazy" style="height:${height}px" srcdoc="${escapeAttr(srcdoc)}"></iframe></div>`;
}

/** 供其他渲染器(如 paramSelect 的组级仿真)按 §2.5 规则渲染 sandbox。 */
export function renderSandboxBlock(block, course) {
  return renderSandbox(block, course);
}

function tableCellText(cell) {
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell);
  if (!cell || typeof cell !== 'object') return '';
  if (Array.isArray(cell.spans)) return textFromSpans(cell.spans);
  if (cell.text != null) return String(cell.text);
  const images = Array.isArray(cell.images) && cell.images.length ? cell.images : [cell.image];
  return images.find((image) => image?.alt)?.alt || '';
}

function positiveSpan(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 1;
}

function renderTableCellContent(cell, course) {
  const rich = cell && typeof cell === 'object' && !Array.isArray(cell);
  const content = rich && Array.isArray(cell.spans)
    ? renderSpans(cell.spans)
    : escapeHtml(rich ? cell.text ?? '' : cell);
  if (!rich) return content;
  if (Array.isArray(cell.images) && cell.images.length) {
    const images = cell.images
      .filter((image) => image && typeof image === 'object' && typeof image.src === 'string' && image.src)
      .map((image) => `<img loading="lazy" onerror="this.style.display='none'" src="${escapeAttr(course.resolveAsset(image.src))}" alt="${escapeAttr(image.alt || '')}">`)
      .join('');
    return `${content}${images ? `<div class="params-table-cell-images">${images}</div>` : ''}`;
  }
  const image = cell.image?.src
    ? `<img loading="lazy" onerror="this.style.display='none'" src="${escapeAttr(course.resolveAsset(cell.image.src))}" alt="${escapeAttr(cell.image.alt || '')}">`
    : '';
  return `${content}${image}`;
}

function renderTableCell(cell, course, { forceHeader = false, label = '' } = {}) {
  const rich = cell && typeof cell === 'object' && !Array.isArray(cell);
  const tag = forceHeader || rich && cell.header === true ? 'th' : 'td';
  const attrs = [];
  if (tag === 'th' && rich && (cell.scope === 'row' || cell.scope === 'col')) attrs.push(`scope="${cell.scope}"`);
  if (rich && positiveSpan(cell.rowspan) > 1) attrs.push(`rowspan="${positiveSpan(cell.rowspan)}"`);
  if (rich && positiveSpan(cell.colspan) > 1) attrs.push(`colspan="${positiveSpan(cell.colspan)}"`);
  if (!forceHeader && label) attrs.push(`data-label="${escapeAttr(label)}"`);
  return `<${tag}${attrs.length ? ` ${attrs.join(' ')}` : ''}>${renderTableCellContent(cell, course)}</${tag}>`;
}

function buildLogicalTableRows(rows) {
  const active = [];
  return (rows || []).map((row, rowIndex) => {
    const logical = [];
    for (let column = 0; column < active.length; column += 1) {
      if (active[column]?.untilRow > rowIndex) logical[column] = active[column];
      else active[column] = undefined;
    }
    const origins = [];
    let column = 0;
    for (const cell of row) {
      const colspan = positiveSpan(cell?.colspan);
      const rowspan = positiveSpan(cell?.rowspan);
      while (true) {
        while (logical[column]) column += 1;
        let conflict = -1;
        for (let offset = 0; offset < colspan; offset += 1) {
          if (logical[column + offset]) {
            conflict = column + offset;
            break;
          }
        }
        if (conflict < 0) break;
        column = conflict + 1;
      }
      const placement = { cell, column, colspan, untilRow: rowIndex + rowspan };
      origins.push(placement);
      for (let offset = 0; offset < colspan; offset += 1) {
        logical[column + offset] = placement;
        if (rowspan > 1) active[column + offset] = placement;
      }
      column += colspan;
    }
    return { logical, origins };
  });
}

function headerLabels(headers) {
  const labels = [];
  let column = 0;
  for (const cell of headers) {
    const label = tableCellText(cell);
    const colspan = positiveSpan(cell?.colspan);
    for (let offset = 0; offset < colspan; offset += 1) labels[column + offset] = label;
    column += colspan;
  }
  return labels;
}

function uniquePlacements(logical) {
  const seen = new Set();
  return logical.filter((placement) => {
    if (!placement || seen.has(placement)) return false;
    seen.add(placement);
    return true;
  });
}

function isFullColumnHeaderRow(row, columnCount) {
  if (!columnCount || row.logical.length < columnCount) return false;
  const covered = row.logical.slice(0, columnCount);
  if (covered.some((placement) => !placement)) return false;
  return uniquePlacements(covered).every(({ cell }) => cell && typeof cell === 'object'
    && cell.header === true && cell.scope === 'col');
}

function labelsFromHeaderRow(row, columnCount) {
  return Array.from({ length: columnCount }, (_, column) => tableCellText(row.logical[column]?.cell));
}

function placementLabel(placement, labels) {
  return [...new Set(labels.slice(placement.column, placement.column + placement.colspan).filter(Boolean))].join(' / ');
}

function renderMobileTableRecord(row, labels, course) {
  const fields = uniquePlacements(row.logical).map((placement) => `
    <div class="params-table-field">
      <div class="params-table-field-label">${escapeHtml(placementLabel(placement, labels))}</div>
      <div class="params-table-field-value">${renderTableCellContent(placement.cell, course)}</div>
    </div>`).join('');
  return `<div class="params-table-record" role="listitem">${fields}</div>`;
}

function renderTable(block, course) {
  const headers = block.headers || [];
  const logicalRows = buildLogicalTableRows(block.rows || []);
  const initialLabels = headerLabels(headers);
  const columnCount = Math.max(initialLabels.length, ...logicalRows.map((row) => row.logical.length), 0);
  const hasBodyColumnHeader = logicalRows.some((row) => isFullColumnHeaderRow(row, columnCount));
  let labels = initialLabels;
  const desktopRows = [];
  const mobileRows = [];
  for (const row of logicalRows) {
    const columnHeader = isFullColumnHeaderRow(row, columnCount);
    if (columnHeader) labels = labelsFromHeaderRow(row, columnCount);
    desktopRows.push(`<tr>${row.origins.map((placement) => renderTableCell(placement.cell, course, {
      label: columnHeader ? '' : placementLabel(placement, labels),
    })).join('')}</tr>`);
    if (!columnHeader) mobileRows.push(renderMobileTableRecord(row, labels, course));
  }
  const desktop = `<table class="params-table"><thead><tr>${headers.map((cell) => renderTableCell(cell, course, { forceHeader: true })).join('')}</tr></thead><tbody>${desktopRows.join('')}</tbody></table>`;
  const mobileTitle = hasBodyColumnHeader && headers.length === 1
    && positiveSpan(headers[0]?.colspan) >= columnCount
    ? `<div class="params-table-mobile-title">${renderTableCellContent(headers[0], course)}</div>`
    : '';
  const mobile = `<div class="params-table-mobile">${mobileTitle}<div class="params-table-mobile-records" role="list">${mobileRows.join('')}</div></div>`;
  return `<div class="params-table-wrap">${desktop}${mobile}</div>`;
}

function renderList(block) {
  const tag = block.ordered ? 'ol' : 'ul';
  return `<${tag} class="course-list">${(block.items || []).map((item) => `<li>${renderSpans(item)}</li>`).join('')}</${tag}>`;
}

function renderImageGroup(block, course) {
  return `<div class="image-group">${(block.images || []).map((image) => {
    const src = course.resolveAsset(image.src);
    const caption = image.caption == null ? '' : `<figcaption>${escapeHtml(image.caption)}</figcaption>`;
    return `<figure><img loading="lazy" onerror="this.style.display='none'" src="${escapeAttr(src)}" alt="${escapeAttr(image.alt || '')}">${caption}</figure>`;
  }).join('')}</div>`;
}

function renderTabSet(block, course) {
  const tabs = Array.isArray(block.tabs) ? block.tabs : [];
  if (!tabs.length) return '';
  const setId = String(block.id || '');
  const buttons = tabs.map((tab, index) => {
    const tabId = `${setId}-tab-${tab.id}`;
    const panelId = `${setId}-panel-${tab.id}`;
    return `<button type="button" class="tab-set-tab" id="${escapeAttr(tabId)}" role="tab" aria-selected="${index === 0}" aria-controls="${escapeAttr(panelId)}"${index === 0 ? '' : ' tabindex="-1"'} data-action="switch-content-tab">${escapeHtml(tab.label || '')}</button>`;
  }).join('');
  const panels = tabs.map((tab, index) => {
    const tabId = `${setId}-tab-${tab.id}`;
    const panelId = `${setId}-panel-${tab.id}`;
    return `<div class="tab-set-panel" id="${escapeAttr(panelId)}" role="tabpanel" aria-labelledby="${escapeAttr(tabId)}"${index === 0 ? '' : ' hidden'}>${renderBlocks(tab.blocks, course, false)}</div>`;
  }).join('');
  return `<div class="tab-set-container"><div class="tab-set" data-tab-set-id="${escapeAttr(setId)}" role="tablist">${buttons}</div>${panels}</div>`;
}

function renderSummary(block) {
  return `<div class="summary-box"><h4>${escapeHtml(block.title || '')}</h4><ul>${(block.items || []).map((item) => `<li>${renderSpans(item)}</li>`).join('')}</ul></div>`;
}

function renderCompare(block) {
  const headers = block.headers || [];
  const rows = block.rows || [];
  const desktop = `<table class="compare-table"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr><th class="compare-label" scope="row">${escapeHtml(row.label || '')}</th>${(row.cells || []).map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const records = rows.map((row) => {
    const values = [row.label || '', ...(row.cells || [])];
    const fields = values.map((value, column) => `
      <div class="compare-table-field">
        <div class="compare-table-field-label">${escapeHtml(headers[column] || '')}</div>
        <div class="compare-table-field-value">${escapeHtml(value)}</div>
      </div>`).join('');
    return `<div class="compare-table-record" role="listitem">${fields}</div>`;
  }).join('');
  const mobile = `<div class="compare-table-mobile"><div class="compare-table-mobile-records" role="list">${records}</div></div>`;
  return `<div class="compare-box"><h4>${escapeHtml(block.title || '')}</h4><div class="compare-table-wrap">${desktop}${mobile}</div></div>`;
}

function renderQuizBlock(block, quiz) {
  const questions = quiz.sectionQuizzes?.[block.quizRef] || [];
  if (!questions.length) return '';
  return `<div class="section-quiz"><h4>${icon('square-pen')} 小测试</h4>${questions.map((q, idx) => `
    <div class="quiz-item" data-qid="${escapeHtml(q.qid)}">
      <p class="quiz-q">${idx + 1}. ${escapeHtml(q.q)}</p>
      <div class="quiz-opts">${(q.options || []).map((opt) => {
        const value = opt.charAt(0);
        return `<label class="quiz-opt" data-action="select-quiz" data-qid="${escapeHtml(q.qid)}"><input type="radio" name="${escapeHtml(q.qid)}" value="${escapeHtml(value)}"><span>${escapeHtml(opt)}</span></label>`;
      }).join('')}</div>
      <button class="quiz-submit-btn" data-action="submit-quiz" data-qid="${escapeHtml(q.qid)}">提交</button>
      <div class="quiz-fb" id="fb-${escapeHtml(q.qid)}"></div>
    </div>
  `).join('')}</div>`;
}

function renderBlock(block, course, allowTabSet = true) {
  switch (block.type) {
    case 'paragraph':
      return `<p>${renderSpans(block.spans || [])}</p>`;
    case 'numTitle':
      return `<p><strong class="num-title">${escapeHtml(block.text || '')}</strong></p>`;
    case 'boldCaption':
      return `<p><strong>${escapeHtml(block.text || '')}</strong></p>`;
    case 'heading':
      return `<h4>${escapeHtml(block.text || '')}</h4>`;
    case 'image': {
      const src = course.resolveAsset(block.src);
      return `<img loading="lazy" onerror="this.style.display='none'" src="${escapeAttr(src)}" alt="${escapeAttr(block.alt || '')}" style="max-width:100%;margin:8px auto;display:block">`;
    }
    case 'imageGroup':
      return renderImageGroup(block, course);
    case 'list':
      return renderList(block);
    case 'paramsTable':
      return renderTable(block, course);
    case 'tabSet':
      if (!allowTabSet) {
        console.warn('Nested tabSet content blocks are not supported:', block.id);
        return '';
      }
      return renderTabSet(block, course);
    case 'summaryBox':
      return renderSummary(block);
    case 'compareBox':
      return renderCompare(block);
    case 'sectionQuiz':
      return renderQuizBlock(block, course.quiz);
    case 'html':
      return `<div class="course-html">${sanitizeLegacyHtml(block.html || '', course)}</div>`;
    case 'sandbox':
      return renderSandbox(block, course);
    case 'video': {
      const src = course.resolveAsset(block.src);
      const poster = block.poster ? course.resolveAsset(block.poster) : '';
      const captions = block.captions ? course.resolveAsset(block.captions) : '';
      return `<figure class="course-video"><figcaption>${escapeHtml(block.title || '')}</figcaption><video controls playsinline preload="metadata" ${poster ? `poster="${escapeAttr(poster)}"` : ''}><source src="${escapeAttr(src)}">${captions ? `<track kind="captions" src="${escapeAttr(captions)}" default>` : ''}</video></figure>`;
    }
    case 'stepSimulation':
      return renderStepSimulation(block, course);
    case 'paramSelect':
      return renderParamSelect(block, course);
    default:
      console.warn('Unknown content block type:', block.type);
      return '';
  }
}

function renderBlocks(blocks, course, allowTabSet = true) {
  return (blocks || []).map((block) => renderBlock(block, course, allowTabSet)).join('');
}

export function activateContentTab(tab, focus = false) {
  const tablist = tab?.closest?.('[role="tablist"]');
  const container = tablist?.closest?.('.tab-set-container');
  if (!tablist || !container) return;
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const panelId = tab.getAttribute('aria-controls');
  let activePanel;
  tabs.forEach((item) => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
  container.querySelectorAll('.tab-set-panel').forEach((panel) => {
    panel.hidden = panel.id !== panelId;
    if (!panel.hidden) activePanel = panel;
  });
  activePanel?.querySelectorAll('iframe.sandbox-frame').forEach((frame) => {
    const notifyLayout = () => frame.contentWindow?.postMessage({ type: 'pigeon-sandbox-layout' }, '*');
    if (!frame.dataset.layoutLoadBound) {
      frame.addEventListener('load', () => requestAnimationFrame(notifyLayout));
      frame.dataset.layoutLoadBound = '1';
    }
    requestAnimationFrame(notifyLayout);
  });
  if (focus) tab.focus();
}

function renderOverview(section, course) {
  const overview = course.content.overviews?.[section.id];
  if (!overview) return '';
  return `<div class="overview-card" id="overview-${sectionDomId(section.id)}"><h2>${escapeHtml(overview.title || section.title)}</h2>${renderBlocks(overview.blocks, course)}</div>`;
}

function renderKnowledgePoint(kp, course, progress) {
  const content = course.content.knowledgePoints[kp.id];
  if (!content) return '';
  const status = progress[kp.id] || 'opened';
  const label = status === 'mastered' ? '已掌握' : status === 'read' ? '已阅读' : '未开始';
  const mastered = status === 'mastered';
  return `<div class="knowledge-card" id="kp-${escapeHtml(kp.id)}">
    <div class="card-header collapsed" data-action="toggle-card" data-kp-id="${escapeHtml(kp.id)}">
      <span class="card-toggle">▶</span>
      <h3 class="card-title">${escapeHtml(content.title || kp.title)}</h3>
      <span class="mastery-badge ${escapeHtml(status)}" id="badge-${escapeHtml(kp.id)}">${label}</span>
    </div>
    <div class="card-body hidden">
      <div class="card-body-content">
        ${renderBlocks(content.blocks, course)}
        <button class="mastery-btn" data-action="mark-mastered" data-kp-id="${escapeHtml(kp.id)}" ${mastered ? 'style="background:var(--cs);color:#fff;border-color:var(--cs)"' : ''}>${icon('check')} ${mastered ? '已掌握（点击取消）' : '标记为已掌握'}</button>
      </div>
    </div>
  </div>`;
}

export function renderCourseContent(root, course, store) {
  const progress = store.get('progress', {});
  const html = course.manifest.chapters.map((chapter, idx) => `
    <div class="chapter-content" id="ch-${escapeHtml(chapter.id)}" style="display:${idx === 0 ? 'block' : 'none'}">
      ${chapter.sections.map((section) => `
        ${renderOverview(section, course)}
        ${section.knowledgePoints.map((kp) => renderKnowledgePoint(kp, course, progress)).join('')}
      `).join('')}
    </div>
  `).join('');
  root.insertAdjacentHTML('beforeend', html);
}

export function updateBadge(kpId, status) {
  const badge = document.getElementById(`badge-${kpId}`);
  if (badge) {
    badge.className = `mastery-badge ${status}`;
    badge.textContent = status === 'mastered' ? '已掌握' : status === 'read' ? '已阅读' : '未开始';
  }
  const dot = document.getElementById(`dot-${kpId}`);
  if (dot) dot.className = `status-dot ${status}`;
}

export function markRead(kpId, store, onChange) {
  const progress = store.get('progress', {});
  if (progress[kpId] !== 'mastered') {
    progress[kpId] = 'read';
    store.set('progress', progress);
    updateBadge(kpId, 'read');
    onChange?.();
  }
}

export function markMastered(kpId, button, store, onChange) {
  const progress = store.get('progress', {});
  const mastered = progress[kpId] === 'mastered';
  progress[kpId] = mastered ? 'read' : 'mastered';
  store.set('progress', progress);
  if (button) {
    // 文案为静态内容,可安全用 innerHTML 嵌入图标
    button.innerHTML = `${icon('check')} ${mastered ? '标记为已掌握' : '已掌握（点击取消）'}`;
    button.style.background = mastered ? '' : 'var(--cs)';
    button.style.color = mastered ? '' : '#fff';
    button.style.borderColor = mastered ? '' : 'var(--cs)';
  }
  updateBadge(kpId, progress[kpId]);
  onChange?.();
}

export function getAllSections(manifest) {
  return getSections(manifest);
}
