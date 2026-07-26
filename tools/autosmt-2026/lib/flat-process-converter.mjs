function hardStop(message) {
  throw new Error(`[HARD STOP] flat process conversion: ${message}`);
}

function scriptJson(html, name) {
  const match = String(html).match(new RegExp(`var\\s+${name}\\s*=\\s*(['"])((?:\\\\.|(?!\\1)[\\s\\S])*)\\1`));
  if (!match) hardStop(`missing script variable ${name}`);
  try {
    return JSON.parse(match[2].replace(/\\\\\//g, '/'));
  } catch (error) {
    hardStop(`invalid JSON in ${name}: ${error.message}`);
  }
}

function textAt(html, pattern, label) {
  const match = String(html).match(pattern);
  if (!match || !match[1]) hardStop(`missing ${label}`);
  return match[1].replace(/<[^>]+>/g, '').trim();
}

function sourceRecord(target, kind, sourceFile, sourceLocation, value) {
  return { target, kind, sourceFile, sourceLocation, value };
}

function exactEvidence(evidence, scoreNumber, stepCount) {
  if (evidence?.activityKey !== `experiment:${scoreNumber}` || evidence.verified !== true || Number(evidence.finalScore) !== 100) {
    hardStop(`experiment ${scoreNumber} has no verified full-score evidence`);
  }
  const tabs = evidence.submittedTabs || [];
  if (tabs.length !== 1 || tabs[0]?.subIndex !== 0 || tabs[0]?.kind !== 'select') {
    hardStop(`experiment ${scoreNumber} has ambiguous tab evidence`);
  }
  const selected = tabs[0].selected || [];
  if (selected.length !== stepCount) hardStop(`experiment ${scoreNumber} answer count ${selected.length} does not match ${stepCount} steps`);
  return selected.map((item, index) => {
    if (item.field !== index + 1 || !Number.isInteger(item.answerIndex) || item.answerIndex < 1 || !item.value) {
      hardStop(`experiment ${scoreNumber} answer evidence is malformed at field ${index + 1}`);
    }
    return item;
  });
}

function requiredVideo(stepVideos, scoreNumber, step, sourceFile) {
  const entry = stepVideos?.[`experiment:${scoreNumber}:0:${step}`];
  if (!entry || entry.status !== 'captured' || entry.target?.scoreNumber !== scoreNumber || entry.target?.subIndex !== 0 || entry.step !== step) {
    hardStop(`missing captured clip for experiment ${scoreNumber} step ${step + 1}`);
  }
  if (entry.target.rawHtmlFile !== sourceFile || entry.contentType !== 'video/mp4' || !entry.file || !entry.sha256 || !Number.isInteger(entry.bytes) || entry.bytes <= 0) {
    hardStop(`invalid captured clip for experiment ${scoreNumber} step ${step + 1}`);
  }
  return entry;
}

/**
 * Converts a one-tab, flat process-design activity into native blocks.
 * It intentionally accepts already-captured evidence rather than reading or
 * mutating source files, so the caller owns resource copying and hashing.
 */
export function convertFlatProcess({
  activity,
  html,
  evidence,
  stepVideos,
  sourceFile,
  evidenceFile,
  videoEvidenceFile,
  resolveClip,
}) {
  const scoreNumber = activity?.scoreNumber;
  if (!Number.isInteger(scoreNumber) || activity?.scoreType !== 'experiment' || activity?.subIndex !== 0 || activity?.kind !== 'select') {
    hardStop('activity metadata is not a flat experiment select tab');
  }
  if (!sourceFile || activity.rawHtmlFile !== sourceFile) hardStop(`source file mismatch for experiment ${scoreNumber}`);
  if (typeof resolveClip !== 'function') hardStop('resolveClip callback is required');

  const options = scriptJson(html, 'jsonstr_select');
  if (!Array.isArray(options) || !options.length || options.some((option) => typeof option !== 'string' || !option)) {
    hardStop(`experiment ${scoreNumber} has invalid process options`);
  }
  const prompts = [...String(html).matchAll(/<td>\s*(工序\d+)\s*<\/td>\s*<td>\s*<select\b/gu)].map((match) => match[1]);
  const selectCount = (String(html).match(/<select\b/giu) || []).length;
  if (!prompts.length || prompts.length !== selectCount || prompts.length !== activity.selectCount) {
    hardStop(`experiment ${scoreNumber} prompt/select count mismatch`);
  }
  prompts.forEach((prompt, index) => {
    if (prompt !== `工序${index + 1}`) hardStop(`experiment ${scoreNumber} has non-sequential prompt ${prompt}`);
  });

  const answers = exactEvidence(evidence, scoreNumber, prompts.length);
  const title = textAt(html, /<h3>\s*([\s\S]*?)\s*<\/h3>/iu, 'heading');
  const instruction = textAt(html, /<div\s+class="ax-des">\s*([\s\S]*?)\s*<\/div>/iu, 'instruction');
  const id = `experiment-${scoreNumber}-0-process`;
  const ledger = [
    sourceRecord(`${id}/blocks/0/text`, 'activity-heading', sourceFile, 'h3[1]', title),
    sourceRecord(`${id}/blocks/1/spans/0/t`, 'activity-instruction', sourceFile, '.ax-des[1]', instruction),
  ];
  const steps = prompts.map((prompt, index) => {
    const answer = answers[index];
    if (answer.answerIndex > options.length || options[answer.answerIndex - 1] !== answer.value) {
      hardStop(`experiment ${scoreNumber} answer option mismatch at field ${index + 1}`);
    }
    const video = requiredVideo(stepVideos, scoreNumber, index, sourceFile);
    const clip = resolveClip(video);
    if (typeof clip !== 'string' || !clip || /^(?:https?:)?\/\//iu.test(clip)) {
      hardStop(`experiment ${scoreNumber} step ${index + 1} did not resolve to a local clip`);
    }
    const stepTarget = `${id}/steps/${index}`;
    ledger.push(
      sourceRecord(`${stepTarget}/prompt`, 'process-prompt', sourceFile, `#table_gylcsj tr[${index + 2}] td[2]`, prompt),
      sourceRecord(`${stepTarget}/options`, 'process-options', sourceFile, `script:jsonstr_select[${index}]`, options),
      sourceRecord(`${stepTarget}/answerIndex`, 'process-answer', evidenceFile, `submittedTabs[0].selected[field=${index + 1}]`, answer.answerIndex),
      sourceRecord(`${stepTarget}/clip`, 'process-clip', videoEvidenceFile, `steps["experiment:${scoreNumber}:0:${index}"].file`, {
        sourceFile: video.file,
        sha256: video.sha256,
        bytes: video.bytes,
        contentType: video.contentType,
        resolved: clip,
      }),
    );
    return { prompt, options: [...options], answerIndex: answer.answerIndex, clip };
  });

  return {
    id,
    blocks: [
      { type: 'heading', text: title },
      { type: 'paragraph', spans: [{ t: instruction }] },
      { type: 'stepSimulation', id, steps },
    ],
    sourceLedger: ledger,
    audit: {
      scoreNumber,
      sourceFile,
      evidenceFile,
      videoEvidenceFile,
      stepCount: steps.length,
      optionCount: options.length,
      poster: null,
      posterSource: 'none: source process activity has no poster attribute or captured poster resource',
    },
  };
}
