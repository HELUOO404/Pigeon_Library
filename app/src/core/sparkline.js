function n(value) {
  return Math.round(value * 100) / 100;
}

function svg(width, height, body = '') {
  return `<svg viewBox="0 0 ${n(width)} ${n(height)}" width="${n(width)}" height="${n(height)}" preserveAspectRatio="none" aria-hidden="true">${body}</svg>`;
}

export function sparkline(values, opts = {}) {
  const { width = 140, height = 36, strokeWidth = 2, pad = 3, area = true } = opts;
  if (!values.length) return svg(width, height);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = values.length < 2 || min === max;
  const xSpan = width - pad * 2;
  const ySpan = height - pad * 2;
  const points = values.map((value, i) => {
    const x = flat ? pad + (xSpan * i) / Math.max(1, values.length - 1) : pad + (xSpan * i) / (values.length - 1);
    const y = flat ? height / 2 : height - pad - ((value - min) / (max - min)) * ySpan;
    return `${n(x)},${n(y)}`;
  }).join(' ');

  const line = `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="${n(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (!area) return svg(width, height, line);

  const baseline = height - pad;
  const polygon = `<polygon points="${points} ${n(width - pad)},${n(baseline)} ${n(pad)},${n(baseline)}" fill="currentColor" fill-opacity="0.12" stroke="none"/>`;
  return svg(width, height, `${polygon}${line}`);
}

export function sparkbars(values, opts = {}) {
  const { width = 140, height = 36, gap = 2, pad = 2 } = opts;
  if (!values.length) return svg(width, height);

  const baseline = height - pad;
  const max = Math.max(0, ...values);
  const innerWidth = width - pad * 2;
  const barWidth = Math.max(0, (innerWidth - gap * (values.length - 1)) / values.length);
  const bars = values.map((value, i) => {
    const h = max > 0 ? Math.max(1, (Math.max(0, value) / max) * (height - pad * 2)) : 1;
    const x = pad + i * (barWidth + gap);
    return `<rect x="${n(x)}" y="${n(baseline - h)}" width="${n(barWidth)}" height="${n(h)}" fill="currentColor"/>`;
  }).join('');

  return svg(width, height, bars);
}
