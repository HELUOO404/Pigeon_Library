import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { convertProcessGnq } = await import('../lib/process-gnq-converter.mjs');

const html = `
  <table id="table_gylcsj">
    <tr><th>序号</th><th>功能区</th><th>工序</th><th>仿真</th></tr>
    <tr><td>1</td><td rowspan="2"><select class="s1"></select></td><td><select class="s2"></select></td><td><a class="ax-btn"></a></td></tr>
    <tr><td>2</td><td><select class="s2"></select></td><td><a class="ax-btn"></a></td></tr>
    <tr><td>3</td><td rowspan="1"><select class="s1"></select></td><td><select class="s2"></select></td><td><a class="ax-btn"></a></td></tr>
  </table>
  <script>
    var jsonstr_select='[["区域甲","区域乙"],["工序一","工序二","工序三"]]';
    var json_gnqsy='[0,2]';
  </script>`;

const verified = {
  finalScore: 100,
  verified: true,
  selected: [
    { field: 1, answerIndex: 2, value: '区域乙' },
    { field: 5, answerIndex: 1, value: '区域甲' },
    { field: 2, answerIndex: 3, value: '工序三' },
    { field: 4, answerIndex: 1, value: '工序一' },
    { field: 6, answerIndex: 2, value: '工序二' },
  ],
};

const result = convertProcessGnq({
  id: 'exp-26-flow',
  title: '工艺流程设计',
  html,
  verified,
  source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html',
  media: [
    { step: 1, clip: 'assets/media/exp-26-step-01.mp4', poster: 'assets/images/exp-26-step-01.jpg' },
    { step: 2, clip: 'assets/media/exp-26-step-02.mp4', poster: 'assets/images/exp-26-step-02.jpg' },
    { step: 3, clip: 'assets/media/exp-26-step-03.mp4', poster: 'assets/images/exp-26-step-03.jpg' },
  ],
});

assert.deepEqual(result, {
  type: 'stepSimulation',
  id: 'exp-26-flow',
  title: '工艺流程设计',
  groups: [
    {
      prompt: '功能区',
      options: ['区域甲', '区域乙'],
      answerIndex: 2,
      source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html#row-1',
      steps: [
        {
          prompt: '工序',
          options: ['工序一', '工序二', '工序三'],
          answerIndex: 3,
          clip: 'assets/media/exp-26-step-01.mp4',
          poster: 'assets/images/exp-26-step-01.jpg',
          source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html#row-1',
        },
        {
          prompt: '工序',
          options: ['工序一', '工序二', '工序三'],
          answerIndex: 1,
          clip: 'assets/media/exp-26-step-02.mp4',
          poster: 'assets/images/exp-26-step-02.jpg',
          source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html#row-2',
        },
      ],
    },
    {
      prompt: '功能区',
      options: ['区域甲', '区域乙'],
      answerIndex: 1,
      source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html#row-3',
      steps: [
        {
          prompt: '工序',
          options: ['工序一', '工序二', '工序三'],
          answerIndex: 2,
          clip: 'assets/media/exp-26-step-03.mp4',
          poster: 'assets/images/exp-26-step-03.jpg',
          source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html#row-3',
        },
      ],
    },
  ],
});

assert.throws(() => convertProcessGnq({
  id: 'exp-24-flow', title: '工艺流程设计', html,
  verified: { ...verified, finalScore: 83.33, verified: false },
  source: 'tools/autosmt-2026/reports/activity-details/1-1-experiment-24-tab-0.html',
  media: [],
}), /score=100 and verified=true/);

assert.throws(() => convertProcessGnq({
  id: 'exp-26-flow', title: '工艺流程设计', html,
  verified,
  source: 'unsupported-source/26.html',
  media: [],
}), /2026 activity HTML source/);

const withoutPoster = convertProcessGnq({
  id: 'exp-26-no-poster', title: '工艺流程设计', html,
  verified,
  source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html',
  media: [
    { step: 1, clip: 'assets/media/step-01.mp4' },
    { step: 2, clip: 'assets/media/step-02.mp4' },
    { step: 3, clip: 'assets/media/step-03.mp4' },
  ],
});
assert.ok(withoutPoster.groups.flatMap((group) => group.steps).every((step) => !Object.hasOwn(step, 'poster')));

assert.throws(() => convertProcessGnq({
  id: 'exp-26-flow', title: '工艺流程设计', html,
  verified,
  source: 'tools/autosmt-2026/reports/activity-details/1-2-experiment-26-tab-0.html',
  media: [{ step: 1, clip: 'assets/media/only-one.mp4' }],
}), /missing captured media/);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPORTS = path.join(ROOT, 'tools', 'autosmt-2026', 'reports');
const ACTIVITIES = path.join(REPORTS, 'activity-details');
const CAPTURE = path.join(REPORTS, 'source-capture');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const videoEvidence = readJson(path.join(REPORTS, 'process-step-video-capture-v1.json')).steps;
const actualActivities = [
  [23, '1-1', 'ui-state-experiment-23-after-current-v1.json'],
  [24, '1-1', 'ui-state-experiment-24-after-repair-v1.json'],
  [25, '1-2', 'ui-state-experiment-25-after-row-repair-v1.json'],
  [26, '1-2', 'ui-state-experiment-26-after-current-v1.json'],
  [27, '1-2', 'ui-state-experiment-27-after-current-v1.json'],
  [28, '1-2', 'ui-state-experiment-28-after-current-v1.json'],
  [29, '1-3', 'ui-state-experiment-29-after-indexed-v1.json'],
  [30, '1-3', 'ui-state-experiment-30-after-indexed-repair-v1.json'],
  [31, '1-4', 'ui-state-experiment-31-after-indexed-v1.json'],
  [32, '1-5', 'ui-state-experiment-32-after-v3.json'],
];

function sourceOptions(activityHtml) {
  const match = activityHtml.match(/var\s+jsonstr_select\s*=\s*'((?:\\.|[^'])*)'/u);
  assert.ok(match, 'actual process source has jsonstr_select');
  return JSON.parse(match[1].replace(/\\\//g, '/'));
}

for (const [scoreNumber, section, evidenceName] of actualActivities) {
  const sourceName = `${section}-experiment-${scoreNumber}-tab-0.html`;
  const sourcePath = path.join(ACTIVITIES, sourceName);
  const activityHtml = readFileSync(sourcePath, 'utf8');
  const activity = readJson(path.join(ACTIVITIES, sourceName.replace('.html', '.json')));
  const score = readJson(path.join(REPORTS, evidenceName));
  const values = score.tabs?.find((tab) => tab.subIndex === 0)?.selectedValues;
  const optionSets = sourceOptions(activityHtml);
  assert.equal(score.score, 100, `${scoreNumber}: full-score evidence`);
  assert.ok(Array.isArray(values) && values.length > 0 && values.length % 2 === 0, `${scoreNumber}: paired full-score values`);
  const selected = values.map((value, index) => {
    const optionSet = optionSets[index % 2];
    const answerIndex = optionSet.indexOf(value) + 1;
    assert.ok(answerIndex > 0, `${scoreNumber}: answer ${index + 1} exists in source option set`);
    return { field: index + 1, answerIndex, value };
  });
  const clips = Object.entries(videoEvidence)
    .filter(([key]) => key.startsWith(`experiment:${scoreNumber}:0:`))
    .sort((left, right) => left[1].step - right[1].step)
    .map(([, entry]) => {
      const captured = path.join(CAPTURE, entry.file);
      assert.ok(existsSync(captured), `${scoreNumber}/${entry.step}: clip exists`);
      const bytes = readFileSync(captured);
      assert.equal(bytes.length, entry.bytes, `${scoreNumber}/${entry.step}: clip byte count`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `${scoreNumber}/${entry.step}: clip hash`);
      return { step: entry.step + 1, clip: `assets/media/${entry.sha256}.mp4` };
    });
  const actual = convertProcessGnq({
    id: `experiment-${scoreNumber}-0-process`,
    title: activity.label,
    html: activityHtml,
    verified: { finalScore: score.score, verified: true, selected },
    source: `tools/autosmt-2026/reports/activity-details/${sourceName}`,
    media: clips,
  });
  const actualSteps = actual.groups.flatMap((group) => group.steps);
  assert.equal(actual.groups.length + actualSteps.length, activity.selectCount, `${scoreNumber}: every source control is represented`);
  assert.equal(actualSteps.length, clips.length, `${scoreNumber}: every source process row has one clip`);
  assert.ok(actualSteps.every((step) => !Object.hasOwn(step, 'poster')), `${scoreNumber}: no poster is invented`);
}

console.log('process-gnq-converter: ok');
