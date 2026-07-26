const axisHelperSource = String.raw`  const drawAxes = (ctx, origin, yEnd, xEnd, arrowHeight, nxMax, nyMax, scale, token, alternateLabels) => {
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = token('--ink');
    ctx.moveTo(yEnd[0], yEnd[1]);
    ctx.lineTo(origin[0], origin[1]);
    ctx.lineTo(xEnd[0], xEnd[1]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(yEnd[0] - arrowHeight / 2, yEnd[1] + arrowHeight);
    ctx.lineTo(yEnd[0], yEnd[1]);
    ctx.lineTo(yEnd[0] + arrowHeight / 2, yEnd[1] + arrowHeight);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xEnd[0] - arrowHeight, xEnd[1] - arrowHeight / 2);
    ctx.lineTo(xEnd[0], xEnd[1]);
    ctx.lineTo(xEnd[0] - arrowHeight, xEnd[1] + arrowHeight / 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '13px ' + token('--sans');
    ctx.fillStyle = token('--ink');
    const xGap = scale[0] * 10;
    const yGap = scale[1] * 100;
    for (let index = 1; index <= nyMax; index += 1) {
      ctx.beginPath();
      ctx.moveTo(origin[0] - 5, origin[1] - index * yGap);
      ctx.lineTo(origin[0], origin[1] - index * yGap);
      ctx.stroke();
      if (!alternateLabels || index % 2 === 0) ctx.fillText(index * 100, origin[0] - 40, origin[1] - index * yGap + 5);
    }
    ctx.fillText('\u2103', yEnd[0] - 5, yEnd[1] - 5);
    for (let index = 1; index <= nxMax; index += 1) {
      ctx.beginPath();
      ctx.moveTo(origin[0] + index * xGap, origin[1]);
      ctx.lineTo(origin[0] + index * xGap, origin[1] + 5);
      ctx.stroke();
      if (!alternateLabels || index % 2 === 0) ctx.fillText(index * 10, origin[0] + index * xGap - 10, origin[1] + 20);
    }
    ctx.fillText('0', origin[0] - 10, origin[1] + 15);
    ctx.fillText('min', xEnd[0] + 5, xEnd[1] + 3);
  };`;

const drawingSources = Object.freeze({
  'drawing-7-1': runtimeCurveRendererSource('epitaxy'),
  'drawing-16-1': runtimeCurveRendererSource('boron'),
  'drawing-16-2': runtimeCurveRendererSource('phosphorus'),
  'drawing-3-2': String.raw`function renderTemperature(ctx, values, token) {
  const logicalCanvas = 700;
  const [heatTemperature, heatMinutes, depositionTemperature, depositionMinutes] = values.map(Number);
  const colors = [token('--gold'), token('--hover'), token('--correct-bg')];
  const nxMax = 8;
  const nyMax = 8;
  const arrowHeight = 10;
  const scale = [6.5, 0.5];
  const origin = [60, 600];
  const points = [
    [heatMinutes, -heatTemperature],
    [heatMinutes + depositionMinutes, -depositionTemperature],
    [heatMinutes + depositionMinutes + 15, -25],
  ];
  const yEnd = [origin[0], origin[1] - (nyMax + 1) * 100 * scale[1]];
  const xEnd = [origin[0] + (nxMax + 1) * 10 * scale[0], origin[1]];
${axisHelperSource}
  ctx.font = '20px ' + token('--sans');
  ctx.fillStyle = token('--ink');
  ctx.fillText('PECVD\u6e29\u5ea6\u66f2\u7ebf', 270, 40);
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    const priorX = index === 0 ? 0 : points[index - 1][0];
    ctx.fillStyle = colors[index];
    ctx.fillRect(origin[0] + priorX * scale[0], origin[1] + y * scale[1], (x - priorX) * scale[0], -y * scale[1]);
  }
  ctx.lineWidth = 2;
  ctx.setLineDash([3]);
  ctx.strokeStyle = token('--text-soft');
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1] + y * scale[1]);
    ctx.lineTo(origin[0] + x * scale[0], origin[1] + y * scale[1]);
    ctx.lineTo(origin[0] + x * scale[0], origin[1]);
    ctx.stroke();
  }
  ctx.setLineDash([0]);
  drawAxes(ctx, origin, yEnd, xEnd, arrowHeight, nxMax, nyMax, scale, token, false);
  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = token('--seal');
  ctx.moveTo(origin[0], origin[1] - 25 * scale[1]);
  for (const [x, y] of points) ctx.lineTo(origin[0] + x * scale[0], origin[1] + y * scale[1]);
  ctx.stroke();
  return logicalCanvas;
}`,
  'drawing-15-1': diffusionRendererSource('\u6db2\u6001\u787c\u6269\u6563\u6e29\u5ea6\u66f2\u7ebf'),
  'drawing-15-2': diffusionRendererSource('\u6db2\u6001\u78f7\u6269\u6563\u6e29\u5ea6\u66f2\u7ebf'),
});

function runtimeCurveRendererSource(kind) {
  const title = kind === 'epitaxy'
    ? '\u5916\u5ef6\u6e29\u5ea6\u66f2\u7ebf'
    : kind === 'boron'
      ? '\u56fa\u6001\u6e90\u6269\u6563\u6e29\u5ea6\u66f2\u7ebf'
      : '\u56fa\u6001\u6e90\u6269\u6563\u6e29\u5ea6\u66f2\u7ebf';
  const pointsSource = kind === 'epitaxy'
    ? `  const [heatTemperature, substrateTemperature, substrateMinutes, purgeTemperature, purgeMinutes, growthTemperature, growthMinutes, holdTemperature, holdMinutes, coolTemperature] = values.map(Number);
  const points = [
    [0, 25],
    [60, heatTemperature],
    [60 + substrateMinutes, substrateTemperature],
    [60 + substrateMinutes + 3, purgeTemperature],
    [60 + substrateMinutes + 3 + purgeMinutes, purgeTemperature],
    [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes, growthTemperature],
    [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10, growthTemperature],
    [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10 + holdMinutes, holdTemperature],
    [60 + substrateMinutes + 3 + purgeMinutes + growthMinutes + 10 + holdMinutes + 30, coolTemperature],
  ];`
    : `  const [preheatTemperature, sourceTemperature, sourceMinutes] = values.map(Number);
  const points = [
    [0, 25],
    [60, preheatTemperature],
    [60 + sourceMinutes, sourceTemperature],
    [100, 25],
  ];`;
  const xMax = kind === 'epitaxy' ? 15 : 12;
  const yMax = kind === 'epitaxy' ? 14 : 12;
  return String.raw`function renderTemperature(ctx, values, token) {
  const logicalCanvas = 700;
${pointsSource}
  const colors = [token('--gold'), token('--correct-bg'), token('--hover'), token('--correct-bg'), token('--gold-deep'), token('--correct-bg'), token('--hover'), token('--correct-bg'), token('--seal')];
  const origin = [60, 600];
  const scale = [${kind === 'epitaxy' ? 6 : 8}, 0.3];
  const nxMax = ${xMax};
  const nyMax = ${yMax};
  const yEnd = [origin[0], origin[1] - (nyMax + 1) * 100 * scale[1]];
  const xEnd = [origin[0] + (nxMax + 1) * 10 * scale[0], origin[1]];
  const drawAxes = (ctx, origin, yEnd, xEnd) => {
    ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = token('--ink');
    ctx.moveTo(yEnd[0], yEnd[1]); ctx.lineTo(origin[0], origin[1]); ctx.lineTo(xEnd[0], xEnd[1]); ctx.stroke();
    ctx.font = '13px ' + token('--sans'); ctx.fillStyle = token('--ink');
    for (let index = 1; index <= nyMax; index += 1) {
      const y = origin[1] - index * 100 * scale[1];
      ctx.beginPath(); ctx.moveTo(origin[0] - 5, y); ctx.lineTo(origin[0], y); ctx.stroke(); ctx.fillText(index * 100, origin[0] - 40, y + 5);
    }
    for (let index = 1; index <= nxMax; index += 1) {
      const x = origin[0] + index * 10 * scale[0];
      ctx.beginPath(); ctx.moveTo(x, origin[1]); ctx.lineTo(x, origin[1] + 5); ctx.stroke(); ctx.fillText(index * 10, x - 10, origin[1] + 20);
    }
    ctx.fillText('\u2103', yEnd[0] - 5, yEnd[1] - 5); ctx.fillText('0', origin[0] - 10, origin[1] + 15); ctx.fillText('min', xEnd[0] + 5, xEnd[1] + 3);
  };
  ctx.font = '20px ' + token('--sans'); ctx.fillStyle = token('--ink'); ctx.fillText('${title}', 230, 40);
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index]; const [priorX] = points[index - 1];
    ctx.fillStyle = colors[(index - 1) % colors.length];
    ctx.fillRect(origin[0] + priorX * scale[0], origin[1] - y * scale[1], (x - priorX) * scale[0], y * scale[1]);
  }
  ctx.lineWidth = 2; ctx.setLineDash([3]); ctx.strokeStyle = token('--text-soft');
  for (const [x, y] of points) { ctx.beginPath(); ctx.moveTo(origin[0], origin[1] - y * scale[1]); ctx.lineTo(origin[0] + x * scale[0], origin[1] - y * scale[1]); ctx.lineTo(origin[0] + x * scale[0], origin[1]); ctx.stroke(); }
  ctx.setLineDash([0]); drawAxes(ctx, origin, yEnd, xEnd);
  ctx.beginPath(); ctx.lineWidth = 3; ctx.strokeStyle = token('--seal'); ctx.moveTo(origin[0], origin[1] - 25 * scale[1]);
  for (const [x, y] of points) ctx.lineTo(origin[0] + x * scale[0], origin[1] - y * scale[1]);
  ctx.stroke(); return logicalCanvas;
}`;
}

function diffusionRendererSource(title) {
  return String.raw`function renderTemperature(ctx, values, token) {
  const logicalCanvas = 700;
  const [predepositionTemperature, sourceMinutes, driveInTemperature, redistributionTemperature, dryOxidationMinutes] = values.map(Number);
  const colors = [token('--gold'), token('--correct-bg'), token('--hover'), token('--wrong-bg'), token('--gold-deep'), token('--wrong-bg'), token('--correct-bg')];
  const nxMax = 23;
  const nyMax = 14;
  const arrowHeight = 10;
  const scale = [2.5, 0.3];
  const origin = [60, 600];
  const points = [
    [60, -950],
    [sourceMinutes + 60, -predepositionTemperature],
    [80 + sourceMinutes, -driveInTemperature],
    [110 + sourceMinutes, -redistributionTemperature],
    [140 + sourceMinutes, -redistributionTemperature],
    [140 + sourceMinutes + dryOxidationMinutes, -redistributionTemperature],
    [170 + sourceMinutes + dryOxidationMinutes, -25],
  ];
  const yEnd = [origin[0], origin[1] - (nyMax + 1) * 100 * scale[1]];
  const xEnd = [origin[0] + (nxMax + 1) * 10 * scale[0], origin[1]];
${axisHelperSource}
  ctx.font = '25px ' + token('--sans');
  ctx.fillStyle = token('--ink');
  ctx.fillText('${title}', 250, 100);
  for (let index = 0; index < points.length; index += 1) {
    const [x, y] = points[index];
    const priorX = index === 0 ? 0 : points[index - 1][0];
    ctx.fillStyle = colors[index];
    ctx.fillRect(origin[0] + priorX * scale[0], origin[1] + y * scale[1], (x - priorX) * scale[0], -y * scale[1]);
  }
  ctx.lineWidth = 2;
  ctx.setLineDash([3]);
  ctx.strokeStyle = token('--text-soft');
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.moveTo(origin[0], origin[1] + y * scale[1]);
    ctx.lineTo(origin[0] + x * scale[0], origin[1] + y * scale[1]);
    ctx.lineTo(origin[0] + x * scale[0], origin[1]);
    ctx.stroke();
  }
  ctx.setLineDash([0]);
  drawAxes(ctx, origin, yEnd, xEnd, arrowHeight, nxMax, nyMax, scale, token, true);
  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = token('--seal');
  ctx.moveTo(origin[0], origin[1] - 25 * scale[1]);
  for (const [x, y] of points) ctx.lineTo(origin[0] + x * scale[0], origin[1] + y * scale[1]);
  ctx.stroke();
  return logicalCanvas;
}`;
}

export function temperatureDrawingRendererSource(id) {
  const source = drawingSources[id];
  if (!source) throw new Error(`Unsupported temperature drawing: ${id}`);
  return source;
}
