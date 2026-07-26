function deviceOutputDrawingRendererSource(id) {
  if (id === 'drawing-22-2') {
    return String.raw`function renderDeviceOutput(ctx, values, token) {
  const logicalCanvas = 700;
  const origin = [70, 620];
  const xScale = 700;
  const yScale = 6.5;
  const currentRows = [[0, 1, 20, 40, 60, 80], [0.5, 1, 20, 40, 60, 80]];
  const voltageRows = [values.slice(0, 6).map(Number), values.slice(6, 12).map(Number)];
  ctx.font = '16px ' + token('--sans');
  ctx.fillStyle = token('--ink');
  ctx.strokeStyle = token('--ink');
  ctx.lineWidth = 2;
  ctx.fillText('PN节VI特性曲线仿真', 235, 38);
  ctx.beginPath();
  ctx.moveTo(origin[0], 70);
  ctx.lineTo(origin[0], origin[1]);
  ctx.lineTo(640, origin[1]);
  ctx.stroke();
  ctx.fillText('Ib(uA)', 24, 76);
  ctx.fillText('Ube(V)', 642, origin[1] + 4);
  for (let step = 1; step <= 8; step += 1) {
    const x = origin[0] + step * 0.1 * xScale;
    ctx.beginPath();
    ctx.moveTo(x, origin[1]);
    ctx.lineTo(x, origin[1] + 5);
    ctx.stroke();
    ctx.fillText((step / 10).toFixed(1), x - 10, origin[1] + 22);
  }
  for (let current = 20; current <= 80; current += 20) {
    const y = origin[1] - current * yScale;
    ctx.beginPath();
    ctx.moveTo(origin[0] - 5, y);
    ctx.lineTo(origin[0], y);
    ctx.stroke();
    ctx.fillText(String(current), origin[0] - 34, y + 5);
  }
  const series = [
    { label: '25℃', stroke: token('--gold') },
    { label: '100℃', stroke: token('--seal') },
  ];
  series.forEach(function(item, seriesIndex) {
    ctx.beginPath();
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = 3;
    voltageRows[seriesIndex].forEach(function(voltage, index) {
      const x = origin[0] + voltage * xScale;
      const y = origin[1] - currentRows[seriesIndex][index] * yScale;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = item.stroke;
    ctx.fillText(item.label, 535, 92 + seriesIndex * 28);
  });
  return logicalCanvas;
}`;
  }

  if (id === 'drawing-19-1' || id === 'drawing-38-1') {
    return String.raw`function renderDeviceOutput(ctx, values, token) {
  const logicalCanvas = 700;
  const nxMax = 9, nyMax = 6;
  const arh = 10;
  const dw = [60, 80];
  const pto = [50, 650];
  const array_ptx = [0.3, 4, 8, 0.3, 4, 8, 0.3, 4, 8];
  const strlinetext = ['IB=0', 'IB=40uA', 'IB=80uA'];
  const oslt = Array.from({ length: 9 }, (_, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) ? value : 0;
  });
  const ptsd = oslt.map((value, index) => [
    pto[0] + array_ptx[index] * dw[0],
    pto[1] - value * dw[1],
  ]);
  const ptyd = [pto[0], pto[1] - nyMax * dw[1]];
  const ptxd = [pto[0] + nxMax * dw[0], pto[1]];

  ctx.font = '25px ' + token('--sans');
  ctx.fillStyle = token('--ink');
  ctx.strokeStyle = token('--ink');
  ctx.fillText('NPN_VI\u7279\u6027\u66f2\u7ebf', 250, 50);
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.moveTo(ptyd[0], ptyd[1]);
  ctx.lineTo(pto[0], pto[1]);
  ctx.lineTo(ptxd[0], ptxd[1]);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ptyd[0] - arh / 2, ptyd[1] + arh);
  ctx.lineTo(ptyd[0], ptyd[1]);
  ctx.lineTo(ptyd[0] + arh / 2, ptyd[1] + arh);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ptxd[0] - arh, ptxd[1] - arh / 2);
  ctx.lineTo(ptxd[0], ptxd[1]);
  ctx.lineTo(ptxd[0] - arh, ptxd[1] + arh / 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = '18px ' + token('--sans');
  ctx.strokeStyle = token('--ink');
  for (let i = 1; i < nyMax; i += 1) {
    ctx.beginPath();
    ctx.moveTo(pto[0] - 5, pto[1] - i * dw[1]);
    ctx.lineTo(pto[0], pto[1] - i * dw[1]);
    ctx.stroke();
    ctx.fillText(i, pto[0] - 20, pto[1] - i * dw[1] + 5);
  }
  ctx.fillText('Ic/mA', ptyd[0] - 25, ptyd[1] - 5);
  for (let i = 1; i < nxMax; i += 1) {
    ctx.beginPath();
    ctx.moveTo(pto[0] + i * dw[0], pto[1]);
    ctx.lineTo(pto[0] + i * dw[0], pto[1] + 5);
    ctx.stroke();
    ctx.fillText(i, pto[0] + i * dw[0] - 5, pto[1] + 25);
  }
  ctx.fillText('0', pto[0] - 10, pto[1] + 20);
  ctx.fillText('Uce/V', ptxd[0] + 5, ptxd[1] + 3);

  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = token('--seal');
  for (let i = 0; i < 3; i += 1) {
    const a = 0.2, b = 3;
    ctx.moveTo(pto[0], pto[1]);
    ctx.lineTo(
      ptsd[i * 3][0] - 0.3 * a * dw[0],
      ptsd[i * 3][1] + oslt[i * 3] * a * dw[1],
    );
    ctx.quadraticCurveTo(
      ptsd[i * 3][0],
      ptsd[i * 3][1],
      pto[0] + b * dw[0],
      ptsd[i * 3 + 2][1],
    );
    ctx.lineTo(ptsd[i * 3 + 2][0] + dw[0], ptsd[i * 3 + 2][1]);
    ctx.fillText(strlinetext[i], ptsd[i * 3 + 2][0], ptsd[i * 3 + 2][1] - 5);
  }
  ctx.stroke();
}`;
  }

  if (id === 'drawing-19-2' || id === 'drawing-38-2') {
    return String.raw`function renderDeviceOutput(ctx, values, token) {
  const logicalCanvas = 700;
  const nxMax = 21, nyMax = 6;
  const arh = 10;
  const dw = [27, 80];
  const pto = [50, 650];
  const array_ptx = [0.3, 10, 20, 0.3, 10, 20, 0.3, 10, 20];
  const strlinetext = ['Ugs=0', 'Ugs=4V', 'Ugs=6V'];
  const oslt = Array.from({ length: 9 }, (_, index) => {
    const value = Number(values[index]);
    return Number.isFinite(value) ? value : 0;
  });
  const ptsd = oslt.map((value, index) => [
    pto[0] + array_ptx[index] * dw[0],
    pto[1] - value * dw[1],
  ]);
  const ptyd = [pto[0], pto[1] - nyMax * dw[1]];
  const ptxd = [pto[0] + nxMax * dw[0], pto[1]];

  ctx.font = '25px ' + token('--sans');
  ctx.fillStyle = token('--ink');
  ctx.strokeStyle = token('--ink');
  ctx.fillText('NMOS_VI\u7279\u6027\u66f2\u7ebf', 250, 50);
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.moveTo(ptyd[0], ptyd[1]);
  ctx.lineTo(pto[0], pto[1]);
  ctx.lineTo(ptxd[0], ptxd[1]);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ptyd[0] - arh / 2, ptyd[1] + arh);
  ctx.lineTo(ptyd[0], ptyd[1]);
  ctx.lineTo(ptyd[0] + arh / 2, ptyd[1] + arh);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ptxd[0] - arh, ptxd[1] - arh / 2);
  ctx.lineTo(ptxd[0], ptxd[1]);
  ctx.lineTo(ptxd[0] - arh, ptxd[1] + arh / 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = '18px ' + token('--sans');
  ctx.strokeStyle = token('--ink');
  for (let i = 1; i < nyMax; i += 1) {
    ctx.beginPath();
    ctx.moveTo(pto[0] - 5, pto[1] - i * dw[1]);
    ctx.lineTo(pto[0], pto[1] - i * dw[1]);
    ctx.stroke();
    ctx.fillText(i, pto[0] - 20, pto[1] - i * dw[1] + 5);
  }
  ctx.fillText('ID/mA', ptyd[0] - 25, ptyd[1] - 5);
  for (let i = 1; i < nxMax; i += 1) {
    ctx.beginPath();
    ctx.moveTo(pto[0] + i * dw[0], pto[1]);
    ctx.lineTo(pto[0] + i * dw[0], pto[1] + 5);
    ctx.stroke();
    if (i % 5 === 0) ctx.fillText(i, pto[0] + i * dw[0] - 5, pto[1] + 25);
  }
  ctx.fillText('0', pto[0] - 10, pto[1] + 20);
  ctx.fillText('Uds/V', ptxd[0] + 5, ptxd[1] + 3);

  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = token('--seal');
  for (let i = 0; i < 3; i += 1) {
    ctx.moveTo(pto[0], pto[1]);
    for (let j = 0; j < 2; j += 1) {
      const pt = [
        (ptsd[j + i * 3][0] + ptsd[j + 1 + i * 3][0]) / 2,
        (ptsd[j + i * 3][1] + ptsd[j + 1 + i * 3][1]) / 2,
      ];
      ctx.quadraticCurveTo(
        ptsd[j + i * 3][0],
        ptsd[j + i * 3][1],
        pt[0],
        pt[1],
      );
    }
    ctx.lineTo(ptsd[i * 3 + 2][0] + dw[0], ptsd[i * 3 + 2][1]);
    ctx.fillText(strlinetext[i], ptsd[i * 3 + 2][0] - 50, ptsd[i * 3 + 2][1] - 10);
  }
  ctx.stroke();
}`;
  }

  return null;
}

export { deviceOutputDrawingRendererSource };
