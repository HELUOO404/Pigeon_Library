function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function positiveInteger(value, fallback, name) {
  const dimension = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(dimension) || dimension < 1) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return dimension;
}

export function buildDrawingSandbox({
  id,
  title,
  tableHtml,
  options,
  answers,
  labels = [],
  initialValues = null,
  actions = null,
  rendererSource,
  height = 760,
  canvasWidth = 700,
  canvasHeight = 700,
}) {
  if (!id || !title || !tableHtml || !Array.isArray(options) || !Array.isArray(answers)) {
    throw new TypeError('drawing sandbox requires id, title, tableHtml, options, and answers');
  }
  if (options.length !== answers.length) throw new Error(`drawing answer count mismatch for ${id}`);
  if (initialValues != null && (!Array.isArray(initialValues) || initialValues.length !== options.length)) {
    throw new Error(`drawing initial value count mismatch for ${id}`);
  }
  if ((tableHtml.match(/data-control-index=/g) || []).length !== options.length) {
    throw new Error(`drawing control count mismatch for ${id}`);
  }
  if (typeof rendererSource !== 'string' || !/^function\s+render[A-Za-z0-9_]*\s*\(/.test(rendererSource)) {
    throw new TypeError(`drawing renderer source missing for ${id}`);
  }
  if (/<\/script\s*>/i.test(rendererSource)) throw new Error(`unsafe drawing renderer source for ${id}`);

  const intrinsicCanvasWidth = positiveInteger(canvasWidth, 700, 'canvasWidth');
  const intrinsicCanvasHeight = positiveInteger(canvasHeight, 700, 'canvasHeight');

  const drawingActions = actions == null ? ['生成曲线'] : actions;
  if (!Array.isArray(drawingActions) || !drawingActions.length || drawingActions.some((action) => typeof action !== 'string' || !action)) {
    throw new TypeError(`drawing actions must be a non-empty string array for ${id}`);
  }

  const spec = JSON.stringify({ id, options, answers, labels, initialValues, actions: drawingActions }).replace(/</g, '\\u003c');
  const actionHtml = drawingActions.map((action, index) => `<button type="button" class="drawing-primary" data-drawing-action="${index}"${drawingActions.length === 1 ? ' data-drawing-draw' : ''}>${escapeHtml(action)}</button>`).join('');
  const script = String.raw`<script>
const spec=__SPEC__;const renderDrawing=__RENDERER__;const root=document.querySelector('[data-drawing-simulation]');
const canvas=root.querySelector('canvas');const ctx=canvas.getContext('2d');const status=root.querySelector('[data-drawing-status]');
const selects=Array.from(root.querySelectorAll('select[data-control-index]')).sort(function(a,b){return Number(a.dataset.controlIndex)-Number(b.dataset.controlIndex)});
const token=function(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()||'currentColor'};
root.querySelectorAll('[data-drawing-mark-token]').forEach(function(mark){mark.style.backgroundColor=token(mark.dataset.drawingMarkToken)});
let answerMode=false;let practiceValues=[];let activeAction=0;
spec.options.forEach(function(values,index){const select=selects[index];if(!select)throw new Error('drawing control '+index+' missing');if(spec.labels[index])select.setAttribute('aria-label',spec.labels[index]);const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择..';select.appendChild(placeholder);values.forEach(function(value){const option=document.createElement('option');option.value=String(value);option.textContent=String(value);select.appendChild(option)})});
function currentValues(){return selects.map(function(select){return select.value})}
function complete(values){return values.length===spec.options.length&&values.every(function(value){return value!==''})}
function clearCanvas(){ctx.clearRect(0,0,canvas.width,canvas.height)}
function drawValues(values,score,actionIndex){if(!complete(values))return;activeAction=actionIndex==null?activeAction:actionIndex;clearCanvas();renderDrawing(ctx,values.map(function(value){const numeric=Number(value);return Number.isFinite(numeric)?numeric:value}),token,activeAction,spec.actions[activeAction]);if(score){const correct=values.reduce(function(total,value,index){return total+(value===String(spec.answers[index])?1:0)},0);parent.postMessage({type:'pigeon-score',score:correct,total:values.length},'*')}}
function reportHeight(){parent.postMessage({pigeonHeight:Math.ceil(document.documentElement.scrollHeight)},'*')}
function setStatus(value){status.textContent=value||''}
function clearAll(){answerMode=false;practiceValues=[];activeAction=0;selects.forEach(function(select){select.disabled=false;select.value=''});setStatus('');clearCanvas();parent.postMessage({type:'pigeon-score-clear'},'*');parent.postMessage({type:'pigeon-sandbox-mode',mode:'practice'},'*');reportHeight()}
function showAnswer(){if(!answerMode)practiceValues=currentValues();answerMode=true;selects.forEach(function(select,index){select.disabled=true;select.value=String(spec.answers[index])});setStatus('参考答案已显示');drawValues(currentValues(),false);reportHeight()}
function showPractice(){answerMode=false;selects.forEach(function(select,index){select.disabled=false;select.value=practiceValues[index]||''});setStatus('');clearCanvas();reportHeight()}
root.querySelectorAll('[data-drawing-action]').forEach(function(button){button.addEventListener('click',function(){if(answerMode)return;const values=currentValues();const missing=values.findIndex(function(value){return value==='' });if(missing>=0){setStatus('请完成参数选择');selects[missing].focus();return}setStatus('');drawValues(values,true,Number(button.dataset.drawingAction))})});
root.querySelector('[data-drawing-clear]').addEventListener('click',clearAll);
selects.forEach(function(select){select.addEventListener('change',function(){if(!answerMode)setStatus('')})});
addEventListener('message',function(event){if(event.source!==parent||!event.data)return;const type=event.data.type;if(type==='pigeon-sandbox-mode'){if(event.data.mode==='answer')showAnswer();else showPractice();return}if(type==='pigeon-sandbox-restore'){setTimeout(function(){if(!answerMode&&complete(currentValues()))drawValues(currentValues(),false);else if(!answerMode&&spec.initialValues)drawValues(spec.initialValues,false)},0);return}if(type==='pigeon-theme'){setTimeout(function(){if(answerMode)drawValues(spec.answers,false);else if(complete(currentValues()))drawValues(currentValues(),false);else if(spec.initialValues)drawValues(spec.initialValues,false)},0);return}if(type==='pigeon-sandbox-layout')setTimeout(reportHeight,0)});
addEventListener('load',reportHeight);if(window.ResizeObserver)new ResizeObserver(reportHeight).observe(root);if(spec.initialValues)drawValues(spec.initialValues,false);setTimeout(reportHeight,0);
</script>`;
  const style = `<style>
html,body{margin:0;padding:0;overflow:hidden;background:var(--paper);color:var(--text);font-family:var(--sans);line-height:1.6}
*{box-sizing:border-box}.drawing-simulation{max-width:100%;overflow:hidden}.drawing-simulation h3{margin:0 0 .75rem;color:var(--ink);font-family:var(--serif);font-size:1.1rem}.drawing-layout{display:grid;grid-template-columns:minmax(0,18rem) minmax(0,1fr);gap:1rem;align-items:start;max-width:100%}.drawing-fields,.drawing-canvas-wrap{min-width:0;max-width:100%}.drawing-fields table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed}.drawing-fields th,.drawing-fields td{border:1px solid var(--line);padding:.5rem;vertical-align:top;overflow-wrap:anywhere}.drawing-fields th{background:var(--surface);color:var(--ink);font-weight:700}.drawing-fields [data-drawing-mark-token]{display:inline-block;width:1rem;height:1rem;margin-inline-end:.4rem;vertical-align:-.15rem;border:1px solid var(--line)}.drawing-fields p{margin:.25rem 0}.drawing-fields select,.drawing-actions button{max-width:100%;min-height:2.5rem;padding:.45rem .625rem;font:inherit;color:var(--text);background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}.drawing-fields select{width:100%}.drawing-actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}.drawing-actions button{cursor:pointer}.drawing-primary{background:var(--ink)!important;color:var(--paper)!important;border-color:var(--ink)!important;font-weight:700}.drawing-secondary{background:var(--card);color:var(--ink)}.drawing-status{min-height:1.5em;margin:.5rem 0 0;color:var(--seal)}.drawing-canvas{display:block;width:100%;height:auto;max-width:100%;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius)}
@media (max-width:48rem){.drawing-layout{grid-template-columns:minmax(0,1fr)}.drawing-fields th,.drawing-fields td{padding:.4rem}.drawing-canvas-wrap{width:100%}}
</style>`;
  const html = `<!doctype html><html><head><meta charset="utf-8">${style}</head><body><main class="drawing-simulation" data-drawing-simulation data-drawing-id="${escapeHtml(id)}"><h3>${escapeHtml(title)}</h3><div class="drawing-layout"><div class="drawing-fields">${tableHtml}<div class="drawing-actions" role="group" aria-label="仿真控制">${actionHtml}<button type="button" class="drawing-secondary" data-drawing-clear>清空</button></div><p class="drawing-status" data-drawing-status role="status"></p></div><div class="drawing-canvas-wrap"><canvas class="drawing-canvas" width="${intrinsicCanvasWidth}" height="${intrinsicCanvasHeight}" aria-label="${escapeHtml(title)}"></canvas></div></div></main>${script.replace('__SPEC__', spec).replace('__RENDERER__', rendererSource)}</body></html>`;
  return { type: 'sandbox', id, html, height: Math.max(700, Number(height) || 760), modeSwitch: true };
}
