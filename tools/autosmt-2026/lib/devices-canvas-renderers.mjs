import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RUNTIME_CAPTURE = path.join(ROOT, 'tools', 'autosmt-2026', 'reports', 'runtime-response-capture-v1.json');
const COLOR_TOKEN_NAMES = ['--paper', '--surface', '--card', '--ink', '--text', '--text-soft', '--line', '--line-2', '--gold', '--gold-deep', '--seal', '--hover', '--correct-bg', '--correct-tx', '--wrong-bg', '--wrong-tx'];
const REQUIRED_LOCATIONS = {
  22: { chapterIndex: 1, sectionIndex: 0, rawHtmlFile: '1-0-experiment-22-tab-0.html', action: 'CZNDJS' },
  33: { chapterIndex: 1, sectionIndex: 6, rawHtmlFile: '1-6-experiment-33-tab-0.html', action: 'LD' },
  34: { chapterIndex: 1, sectionIndex: 6, rawHtmlFile: '1-6-experiment-34-tab-0.html', action: 'LD' },
};
const TEMPERATURE_LOCATIONS = {
  '7:1': { scoreNumber: 7, subIndex: 1, chapterIndex: 0, sectionIndex: 4, rawHtmlFile: '0-4-experiment-7-tab-1.html' },
  '16:1': { scoreNumber: 16, subIndex: 1, chapterIndex: 0, sectionIndex: 7, rawHtmlFile: '0-7-experiment-16-tab-1.html' },
  '16:2': { scoreNumber: 16, subIndex: 2, chapterIndex: 0, sectionIndex: 7, rawHtmlFile: '0-7-experiment-16-tab-2.html' },
};

function evidenceError(message, code = 'DEVICES_CANVAS_EVIDENCE_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function pnBiasRendererSource() {
  return String.raw`function renderPnBias(ctx,values,token,actionIndex,actionLabel){
const pto=[350,150],w=250,h=100;const action=Number(actionIndex)||0;const widthFor=function(value){if(value==='Vbi+VR')return 10.198;if(value==='Vbi-Va')return 5.657;return 0};const indexFor=function(value){if(value==='I|I|')return 1;if(value==='|I|I')return 2;return 0};const array=arguments.length>5&&Array.isArray(arguments[5])?arguments[5].slice():[0.684,8.269/2,8.269/2];if(action===1)array[2]=widthFor(values[1]);else if(action===2)array[2]=widthFor(values[3]);const flag=action===1?indexFor(values[0]):action===2?indexFor(values[2]):0;const title=actionLabel||'PN结偏置电压仿真';const pt_Vbi=array[0]*100,pt_xn=array[1]*10,pt_xp=array[2]*10;const ink=token('--ink'),text=token('--text'),surface=token('--surface'),card=token('--card'),paper=token('--paper'),seal=token('--seal'),line=token('--line');
ctx.font='15px '+token('--sans');ctx.fillStyle=ink;ctx.fillText(title,pto[0]-ctx.measureText(title).width/2,pto[1]-120);ctx.fillStyle=surface;ctx.fillRect(pto[0]-w,pto[1],w-pt_xp,h);ctx.fillStyle=card;ctx.fillRect(pto[0]-pt_xp,pto[1],pt_xp,h);ctx.fillStyle=seal;ctx.fillRect(pto[0],pto[1],pt_xn,h);ctx.fillStyle=paper;ctx.fillRect(pto[0]+pt_xn,pto[1],w-pt_xn,h);ctx.fillStyle=text;ctx.strokeStyle=line;ctx.fillText('P区',pto[0]-w/2-82,pto[1]+h/2+5);ctx.fillText('N区',pto[0]+w/2+50,pto[1]+h/2+5);ctx.fillText('Ec',pto[0]-w-30,pto[1]+204);ctx.fillText('Efi',pto[0]-w-30,pto[1]+304);ctx.fillText('Ev',pto[0]-w-30,pto[1]+404);const x=pt_Vbi*pt_xp/(pt_xp+pt_xn);ctx.fillText('Ef',pto[0]-w-30,pto[1]+304+x);
ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]);ctx.lineTo(pto[0]+w,pto[1]);ctx.lineTo(pto[0]+w,pto[1]+h);ctx.lineTo(pto[0]-w,pto[1]+h);ctx.lineTo(pto[0]-w,pto[1]);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+h/2);ctx.lineTo(pto[0]-w-25,pto[1]+h/2);ctx.lineTo(pto[0]-w-25,pto[1]-80);ctx.lineTo(pto[0]-25,pto[1]-80);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+w,pto[1]+h/2);ctx.lineTo(pto[0]+w+25,pto[1]+h/2);ctx.lineTo(pto[0]+w+25,pto[1]-80);ctx.lineTo(pto[0]+25,pto[1]-80);ctx.stroke();
switch(flag){case 0:ctx.beginPath();ctx.arc(pto[0]-22,pto[1]-80,4,0,2*Math.PI);ctx.stroke();ctx.beginPath();ctx.arc(pto[0]+22,pto[1]-80,4,0,2*Math.PI);ctx.stroke();break;case 1:for(let i=0;i<2;i+=1){ctx.beginPath();ctx.moveTo(pto[0]-25+i*100/3,pto[1]-90);ctx.lineTo(pto[0]-25+i*100/3,pto[1]-70);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]-25+i*100/3+50/3,pto[1]-95);ctx.lineTo(pto[0]-25+i*100/3+50/3,pto[1]-65);ctx.stroke();ctx.fillText('- VR +',pto[0]-ctx.measureText('- VR +').width/2,pto[1]-100)}break;case 2:for(let i=0;i<2;i+=1){ctx.beginPath();ctx.moveTo(pto[0]-25+i*100/3,pto[1]-95);ctx.lineTo(pto[0]-25+i*100/3,pto[1]-65);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]-25+i*100/3+50/3,pto[1]-90);ctx.lineTo(pto[0]-25+i*100/3+50/3,pto[1]-70);ctx.stroke();ctx.fillText('+ Va -',pto[0]-ctx.measureText('+ Va -').width/2,pto[1]-100)}break;}
ctx.beginPath();ctx.moveTo(pto[0]-pt_xp,pto[1]-50);ctx.lineTo(pto[0]-pt_xp,pto[1]+h);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0],pto[1]-20);ctx.lineTo(pto[0],pto[1]+h);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+pt_xn,pto[1]-50);ctx.lineTo(pto[0]+pt_xn,pto[1]+h);ctx.stroke();const arrow=function(y){ctx.beginPath();ctx.moveTo(pto[0]-pt_xp,y);ctx.lineTo(pto[0]+pt_xn,y);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]-pt_xp,y);ctx.lineTo(pto[0]-pt_xp+5,y+2);ctx.lineTo(pto[0]-pt_xp+5,y-2);ctx.lineTo(pto[0]-pt_xp,y);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+pt_xn,y);ctx.lineTo(pto[0]+pt_xn-5,y+2);ctx.lineTo(pto[0]+pt_xn-5,y-2);ctx.lineTo(pto[0]+pt_xn,y);ctx.fill();ctx.stroke();};arrow(pto[1]-10);arrow(pto[1]-30);ctx.font='12px '+token('--sans');ctx.fillText('W',pto[0]+(pt_xn-pt_xp)/2-8,pto[1]-35);ctx.fillText('Xp',pto[0]-20,pto[1]-15);ctx.fillText('Xn',pto[0]+5,pto[1]-15);
ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+200);ctx.lineTo(pto[0]+w,pto[1]+200);ctx.stroke();const b=3*w/4;ctx.beginPath();ctx.moveTo(pto[0]+b,pto[1]+200);ctx.lineTo(pto[0]+b,pto[1]+200+pt_Vbi);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+b,pto[1]+200);ctx.lineTo(pto[0]+b-2,pto[1]+205);ctx.lineTo(pto[0]+b+2,pto[1]+205);ctx.lineTo(pto[0]+b,pto[1]+200);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+b,pto[1]+pt_Vbi+200);ctx.lineTo(pto[0]+b-2,pto[1]+pt_Vbi+195);ctx.lineTo(pto[0]+b+2,pto[1]+pt_Vbi+195);ctx.lineTo(pto[0]+b,pto[1]+pt_Vbi+200);ctx.fill();ctx.stroke();ctx.fillText('Vbi',pto[0]+b+2,pto[1]+240);
ctx.fillStyle=card;for(let i=0;i<4;i+=1){const y=pto[1]+25*i+12.5;ctx.beginPath();ctx.arc(pto[0]-10,y,5,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]-13,y);ctx.lineTo(pto[0]-7,y);ctx.stroke();ctx.beginPath();ctx.arc(pto[0]+10,y,5,0,2*Math.PI);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+7,y);ctx.lineTo(pto[0]+13,y);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+10,y-3);ctx.lineTo(pto[0]+10,y+3);ctx.stroke();}
ctx.lineWidth=3;ctx.strokeStyle=seal;ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+200);ctx.lineTo(pto[0]-pt_xp,pto[1]+200);ctx.lineTo(pto[0]+pt_xn,pto[1]+200+pt_Vbi);ctx.lineTo(pto[0]+w,pto[1]+200+pt_Vbi);ctx.stroke();ctx.strokeStyle=ink;ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+400);ctx.lineTo(pto[0]-pt_xp,pto[1]+400);ctx.lineTo(pto[0]+pt_xn,pto[1]+400+pt_Vbi);ctx.lineTo(pto[0]+w,pto[1]+400+pt_Vbi);ctx.stroke();ctx.strokeStyle=text;ctx.setLineDash([3]);ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+300);ctx.lineTo(pto[0]-pt_xp,pto[1]+300);ctx.lineTo(pto[0]+pt_xn,pto[1]+300+pt_Vbi);ctx.lineTo(pto[0]+w,pto[1]+300+pt_Vbi);ctx.stroke();ctx.strokeStyle=ink;ctx.beginPath();ctx.moveTo(pto[0]-w,pto[1]+300+x);ctx.lineTo(pto[0]+w,pto[1]+300+x);ctx.stroke();ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(pto[0]-pt_xp,pto[1]+100);ctx.lineTo(pto[0]-pt_xp,pto[1]+500);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0],pto[1]+100);ctx.lineTo(pto[0],pto[1]+500);ctx.stroke();ctx.beginPath();ctx.moveTo(pto[0]+pt_xn,pto[1]+100);ctx.lineTo(pto[0]+pt_xn,pto[1]+500);ctx.stroke();
}`;
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys, label) {
  if (!isRecord(value)) throw evidenceError(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw evidenceError(`${label} has an invalid schema.`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw evidenceError(`${label} must be a SHA-256 string.`);
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw evidenceError(`${label} must be a non-empty string.`);
}

function exactLocation(location, scoreNumber, label) {
  const expected = REQUIRED_LOCATIONS[scoreNumber];
  hasExactKeys(location, ['scoreType', 'scoreNumber', 'chapterIndex', 'sectionIndex', 'activity', 'subIndex', 'label', 'rawHtmlFile'], label);
  if (location.scoreType !== 'experiment' || location.scoreNumber !== scoreNumber
    || location.chapterIndex !== expected.chapterIndex || location.sectionIndex !== expected.sectionIndex
    || location.subIndex !== 0 || location.rawHtmlFile !== expected.rawHtmlFile) {
    throw evidenceError(`${label} does not match experiment ${scoreNumber} tab 0 source location.`);
  }
  requireText(location.activity, `${label}.activity`);
  requireText(location.label, `${label}.label`);
}

function sameLocation(left, right) {
  return ['scoreType', 'scoreNumber', 'chapterIndex', 'sectionIndex', 'activity', 'subIndex', 'label', 'rawHtmlFile']
    .every((key) => left[key] === right[key]);
}

function validatedResponse(record, scoreNumber, request, label) {
  hasExactKeys(record, ['activity', 'request', 'response'], label);
  exactLocation(record.activity, scoreNumber, `${label}.activity`);
  hasExactKeys(record.request, Object.keys(request), `${label}.request`);
  if (!isDeepStrictEqual(record.request, request)) throw evidenceError(`${label}.request is not the captured source request.`);
  hasExactKeys(record.response, scoreNumber === 22
    ? ['raw', 'value', 'numericValue', 'sha256']
    : ['raw', 'value', 'sha256'], `${label}.response`);
  requireText(record.response.raw, `${label}.response.raw`);
  requireSha256(record.response.sha256, `${label}.response.sha256`);
  if (sha256(record.response.raw) !== record.response.sha256) throw evidenceError(`${label}.response SHA-256 mismatch.`);
  let parsed;
  try {
    parsed = JSON.parse(record.response.raw);
  } catch {
    throw evidenceError(`${label}.response.raw is not valid JSON.`);
  }
  if (!isDeepStrictEqual(parsed, record.response.value)) throw evidenceError(`${label}.response.value does not match parsed raw JSON.`);
  if (scoreNumber === 22) {
    if (!Array.isArray(record.response.numericValue) || record.response.numericValue.length !== 4
      || record.response.numericValue.some((entry, index) => typeof entry !== 'number' || !Number.isFinite(entry)
        || !Object.is(entry, Number(record.response.value[index])))) {
      throw evidenceError(`${label}.response.numericValue does not match source numeric values.`);
    }
  }
  return record.response.value;
}

function finiteNumberOrString(value) {
  return (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
}

function normalizeSourceColor(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '');
}

function validateCapture(capture) {
  const hasTemperatureCurves = Object.hasOwn(capture || {}, 'temperatureCurves');
  const captureKeys = ['schema', 'capturedAt', 'activities', 'czndjs', 'drawings'];
  if (hasTemperatureCurves) captureKeys.push('temperatureCurves');
  if (Object.hasOwn(capture || {}, 'updatedAt')) captureKeys.push('updatedAt');
  hasExactKeys(capture, captureKeys, 'runtime response capture');
  if (capture.schema !== 'autosmt-runtime-response-capture-v1') throw evidenceError('runtime response capture schema is invalid.');
  requireText(capture.capturedAt, 'runtime response capture.capturedAt');
  if (Number.isNaN(Date.parse(capture.capturedAt))) throw evidenceError('runtime response capture.capturedAt is not a timestamp.');
  if (Object.hasOwn(capture, 'updatedAt')) {
    requireText(capture.updatedAt, 'runtime response capture.updatedAt');
    if (Number.isNaN(Date.parse(capture.updatedAt))) throw evidenceError('runtime response capture.updatedAt is not a timestamp.');
  }
  const expectedActivityCount = hasTemperatureCurves ? 6 : 3;
  if (!Array.isArray(capture.activities) || capture.activities.length !== expectedActivityCount) throw evidenceError(`runtime response capture must contain exactly ${expectedActivityCount} activity records.`);
  if (hasTemperatureCurves && (!Array.isArray(capture.temperatureCurves) || capture.temperatureCurves.length !== 3)) {
    throw evidenceError('runtime response capture must contain exactly three temperature curve responses.');
  }
  if (!Array.isArray(capture.czndjs) || capture.czndjs.length !== 81) throw evidenceError('runtime response capture must contain exactly 81 CZNDJS responses.');
  if (!Array.isArray(capture.drawings) || capture.drawings.length !== 2) throw evidenceError('runtime response capture must contain exactly two LD responses.');

  const activities = new Map();
  const temperatureActivities = new Set();
  for (const item of capture.activities) {
    hasExactKeys(item, ['location', 'action', 'detailSha256'], 'runtime response activity');
    const scoreNumber = item.location?.scoreNumber;
    if (!Object.hasOwn(REQUIRED_LOCATIONS, scoreNumber)) {
      const key = `${scoreNumber}:${item.location?.subIndex}`;
      const expected = TEMPERATURE_LOCATIONS[key];
      hasExactKeys(item.location, ['scoreType', 'scoreNumber', 'chapterIndex', 'sectionIndex', 'activity', 'subIndex', 'label', 'rawHtmlFile'], `runtime response activity ${key}.location`);
      if (!hasTemperatureCurves || !expected || temperatureActivities.has(key)
        || item.location.scoreType !== 'experiment'
        || item.location.chapterIndex !== expected.chapterIndex
        || item.location.sectionIndex !== expected.sectionIndex
        || item.location.rawHtmlFile !== expected.rawHtmlFile
        || item.action !== 'btn_wdqxfz') {
        throw evidenceError('runtime response capture has an unknown or duplicate activity.');
      }
      requireText(item.location.activity, `runtime response activity ${key}.location.activity`);
      requireText(item.location.label, `runtime response activity ${key}.location.label`);
      requireSha256(item.detailSha256, `runtime response activity ${key}.detailSha256`);
      temperatureActivities.add(key);
      continue;
    }
    if (activities.has(scoreNumber)) throw evidenceError('runtime response capture has an unknown or duplicate activity.');
    exactLocation(item.location, scoreNumber, `runtime response activity ${scoreNumber}.location`);
    if (item.action !== REQUIRED_LOCATIONS[scoreNumber].action) throw evidenceError(`runtime response activity ${scoreNumber} has an invalid action.`);
    requireSha256(item.detailSha256, `runtime response activity ${scoreNumber}.detailSha256`);
    activities.set(scoreNumber, item.location);
  }
  if (activities.size !== 3 || ![22, 33, 34].every((score) => activities.has(score))) throw evidenceError('runtime response capture activity set is incomplete.');
  if (hasTemperatureCurves && temperatureActivities.size !== 3) throw evidenceError('runtime response capture temperature activity set is incomplete.');

  const pnValues = {};
  const pnCombinations = new Set();
  for (const record of capture.czndjs) {
    const data1 = record?.request?.data1;
    const data2 = record?.request?.data2;
    const value = validatedResponse(record, 22, { flag: 'CZNDJS', data1, data2 }, 'CZNDJS response');
    if (!sameLocation(record.activity, activities.get(22))) throw evidenceError('CZNDJS response references a different activity source.');
    if (!/^[1-9]$/.test(data1 || '') || !/^[1-9]$/.test(data2 || '')) throw evidenceError('CZNDJS request must use data1/data2 values 1 through 9.');
    const key = `${data1}:${data2}`;
    if (pnCombinations.has(key)) throw evidenceError(`CZNDJS response repeats combination ${key}.`);
    pnCombinations.add(key);
    if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => !finiteNumberOrString(entry))) {
      throw evidenceError(`CZNDJS response ${key} must contain exactly four finite numeric values.`);
    }
    pnValues[key] = value;
  }
  if (pnCombinations.size !== 81) throw evidenceError('CZNDJS response combinations are incomplete.');

  const drawings = new Map();
  const drawingColors = new Map();
  const drawingHashes = new Set();
  const colors = new Set();
  for (const record of capture.drawings) {
    const scoreNumber = record?.activity?.scoreNumber;
    if (scoreNumber !== 33 && scoreNumber !== 34) throw evidenceError('LD response has an unknown activity source.');
    if (drawings.has(scoreNumber)) throw evidenceError(`LD response for experiment ${scoreNumber} is duplicated.`);
    const value = validatedResponse(record, scoreNumber, { flag: 'LD' }, 'LD response');
    if (!sameLocation(record.activity, activities.get(scoreNumber))) throw evidenceError('LD response references a different activity source.');
    if (drawingHashes.has(record.response.sha256)) throw evidenceError('LD responses for experiments 33 and 34 must have different SHA-256 values.');
    drawingHashes.add(record.response.sha256);
    if (!Array.isArray(value) || !value.length) throw evidenceError(`LD response for experiment ${scoreNumber} must be a non-empty rectangle array.`);
    const sourceColors = new Set();
    for (const rectangle of value) {
      if (!Array.isArray(rectangle) || rectangle.length !== 5) throw evidenceError(`LD response for experiment ${scoreNumber} has an invalid rectangle.`);
      const [color, x, y, width, height] = rectangle;
      requireText(color, `LD response ${scoreNumber} rectangle color`);
      if (![x, y, width, height].every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
        throw evidenceError(`LD response for experiment ${scoreNumber} has non-finite geometry.`);
      }
      if (width <= 0 || height <= 0) throw evidenceError(`LD response for experiment ${scoreNumber} rectangles must have positive width and height.`);
      const normalizedColor = normalizeSourceColor(color);
      colors.add(normalizedColor);
      sourceColors.add(normalizedColor);
    }
    drawings.set(scoreNumber, value);
    drawingColors.set(scoreNumber, sourceColors);
  }
  if (drawings.size !== 2 || !drawings.has(33) || !drawings.has(34)) throw evidenceError('LD response set is incomplete.');
  const sortedColors = [...colors].sort();
  if (sortedColors.length > COLOR_TOKEN_NAMES.length) throw evidenceError('LD response uses more colors than the available Pigeon token palette.');
  const colorIndex = new Map(sortedColors.map((color, index) => [color, index]));
  const compactDrawings = Object.fromEntries([...drawings.entries()].map(([score, rectangles]) => [
    score,
    rectangles.map(([color, x, y, width, height]) => [colorIndex.get(normalizeSourceColor(color)), x, y, width, height]),
  ]));
  return {
    pnValues,
    compactDrawings,
    colorTokens: sortedColors.map((_, index) => COLOR_TOKEN_NAMES[index]),
    colorTokenBySource: new Map(sortedColors.map((color, index) => [color, COLOR_TOKEN_NAMES[index]])),
    drawingColors,
  };
}

function pnConcentrationRendererSource(pnValues) {
  const values = JSON.stringify(pnValues).replace(/</g, '\\u003c');
  return String.raw`function renderPnConcentration(ctx,values,token){const key=String(values[1])+':'+String(values[2]);const responses=${values};const array=responses[key];if(!array)throw new Error('PN concentration response for '+key+' was not captured.');if(typeof document!=='undefined'){let cells=Array.from(document.querySelectorAll('.data'));if(cells.length!==4){cells=Array.from(document.querySelectorAll('.drawing-fields table tr')).slice(3,7).map(function(row){return row.querySelector('td:last-child')}).filter(Boolean)}if(cells.length!==4)throw new Error('PN concentration source table does not contain four output cells.');array.forEach(function(value,index){cells[index].textContent=String(value)})}renderPnBias(ctx,values,token,0,'\u5185\u5efa\u7535\u52bf\u548c\u7a7a\u95f4\u7535\u8377\u533a\u5bbd\u5ea6\u4eff\u771f',array)}
${pnBiasRendererSource()}`;
}

function layoutRendererSource(name, rectangles, colorTokens, flipY) {
  const data = JSON.stringify(rectangles).replace(/</g, '\\u003c');
  const tokens = JSON.stringify(colorTokens).replace(/</g, '\\u003c');
  const y = flipY ? '600-rect[2]-rect[4]' : 'rect[2]';
  return String.raw`function ${name}(ctx,values,token){const rectangles=${data};const colorTokens=${tokens};rectangles.forEach(function(rect){ctx.fillStyle=token(colorTokens[rect[0]]);ctx.fillRect(rect[1],${y},rect[3],rect[4])});const rect=rectangles[0];ctx.strokeStyle=token('--ink');ctx.beginPath();ctx.moveTo(rect[1],rect[2]);ctx.lineTo(rect[1]+rect[3],rect[2]);ctx.lineTo(rect[1]+rect[3],rect[2]+rect[4]);ctx.lineTo(rect[1],rect[2]+rect[4]);ctx.lineTo(rect[1],rect[2]);ctx.stroke()}`;
}

export function devicesCanvasRendererSourceFromCapture(id, capture) {
  const validated = validateCapture(capture);
  if (id === 'drawing-22-0') return pnConcentrationRendererSource(validated.pnValues);
  if (id === 'drawing-33-0') return layoutRendererSource('renderNpnLayout', validated.compactDrawings[33], validated.colorTokens, false);
  if (id === 'drawing-34-0') return layoutRendererSource('renderCmosLayout', validated.compactDrawings[34], validated.colorTokens, true);
  const error = new Error(`${id}: no registered devices canvas renderer`);
  error.code = 'DEVICES_CANVAS_UNKNOWN';
  throw error;
}

export function requireDevicesCanvasColorTokenNames(id, sourceColors, capturePath = RUNTIME_CAPTURE) {
  const scoreNumber = id === 'drawing-33-0' ? 33 : id === 'drawing-34-0' ? 34 : null;
  if (!scoreNumber || !Array.isArray(sourceColors) || !sourceColors.length) {
    throw evidenceError(`${id}: layout legend colors are invalid.`);
  }
  if (!existsSync(capturePath)) throw evidenceError(`${id}: runtime response capture is not present.`, 'DEVICES_CANVAS_EVIDENCE_MISSING');
  let capture;
  try {
    capture = JSON.parse(readFileSync(capturePath, 'utf8'));
  } catch (error) {
    throw evidenceError(`${id}: runtime response capture cannot be read: ${error.message}`);
  }
  const validated = validateCapture(capture);
  return sourceColors.map((sourceColor) => {
    const normalizedColor = normalizeSourceColor(sourceColor);
    if (!validated.drawingColors.get(scoreNumber).has(normalizedColor)) {
      throw evidenceError(`${id}: legend color ${sourceColor} is absent from the captured LD response.`);
    }
    return validated.colorTokenBySource.get(normalizedColor);
  });
}

export function requireDevicesCanvasRendererSource(id, capturePath = RUNTIME_CAPTURE) {
  if (id === 'drawing-22-1') return pnBiasRendererSource();
  if (!['drawing-22-0', 'drawing-33-0', 'drawing-34-0'].includes(id)) {
    const error = new Error(`${id}: no registered devices canvas renderer`);
    error.code = 'DEVICES_CANVAS_UNKNOWN';
    throw error;
  }
  if (!existsSync(capturePath)) throw evidenceError(`${id}: runtime response capture is not present.`, 'DEVICES_CANVAS_EVIDENCE_MISSING');
  let capture;
  try {
    capture = JSON.parse(readFileSync(capturePath, 'utf8'));
  } catch (error) {
    throw evidenceError(`${id}: runtime response capture cannot be read: ${error.message}`);
  }
  return devicesCanvasRendererSourceFromCapture(id, capture);
}
