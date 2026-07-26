/* oxidation-temperature-curve-model.js — 氧化温度曲线的浏览器与 Node 共享公式模型。 */
const oxidationCurveSpec = Object.freeze({
  dw: Object.freeze([3, 2]),
  origins: Object.freeze({
    dry: Object.freeze([60, 330]),
    wet: Object.freeze([60, 670]),
  }),
  axes: Object.freeze({
    xMinutes: 200,
    yDegrees: 1500,
    xTickMinutes: 10,
    yTickDegrees: 100,
    xUnit: 'min',
    yUnit: '℃',
  }),
  correctValues: Object.freeze([800, 850, 920, 20, 60]),
  optionSets: Object.freeze([
    Object.freeze([25, 500, 800, 850, 920, 1100, 1200, 1350]),
    Object.freeze([25, 500, 800, 850, 920, 1100, 1200, 1350]),
    Object.freeze([25, 500, 800, 850, 920, 1100, 1200, 1350]),
    Object.freeze([5, 10, 20, 30, 40, 50, 60, 80]),
    Object.freeze([5, 10, 20, 30, 40, 50, 60, 80]),
  ]),
});

function computeOxidationCurves(values) {
  if (!Array.isArray(values) || values.length !== 5) {
    throw new TypeError('computeOxidationCurves expects five parameter values');
  }
  const numbers = values.map(Number);
  if (numbers.some((value) => !Number.isFinite(value))) {
    throw new TypeError('oxidation curve parameters must be finite numbers');
  }
  const [preheat, hold, oxidation, dryMinutes, wetMinutes] = numbers;
  const [xScale, yScale] = oxidationCurveSpec.dw;
  const shared = [
    [60 * xScale, -preheat / 5],
    [70 * xScale, -hold / 5],
    [90 * xScale, -oxidation / 5],
  ];
  const dry = [
    ...shared.map((point) => [...point]),
    [90 * xScale + dryMinutes * xScale, -oxidation / 5],
    [120 * xScale + dryMinutes * xScale, -2.5 * yScale],
  ];
  const wet = [
    ...shared.map((point) => [...point]),
    [90 * xScale + wetMinutes * xScale, -oxidation / 5],
    [120 * xScale + wetMinutes * xScale, -2.5 * yScale],
  ];
  return {
    values: numbers,
    relativePoints: { dry, wet },
  };
}

const api = Object.freeze({ oxidationCurveSpec, computeOxidationCurves });

if (typeof module !== 'undefined' && module.exports) {
  module.exports.oxidationCurveSpec = oxidationCurveSpec;
  module.exports.computeOxidationCurves = computeOxidationCurves;
}

if (typeof globalThis !== 'undefined') {
  globalThis.OxidationCurveModel = api;
}
