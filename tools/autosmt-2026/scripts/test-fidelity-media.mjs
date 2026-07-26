import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const verifier = path.join(ROOT, '.agents', 'skills', 'pigeon-course-authoring', 'scripts', 'verify-fidelity.mjs');
const fixture = mkdtempSync(path.join(tmpdir(), 'pigeon-fidelity-'));
const course = path.join(fixture, 'course');
mkdirSync(course);

try {
  writeFileSync(path.join(fixture, 'source.html'), `
    <h2>原站视频标题</h2>
    <p>复杂表格原文</p>
    <div>沙箱可见原文</div>
    <script>var options=["步骤原题","选项甲","选项乙"];</script>
  `, 'utf8');
  writeFileSync(path.join(course, 'content.json'), JSON.stringify({
    overviews: {
      '1.1': {
        blocks: [
          { type: 'video', title: '原站视频标题', src: 'assets/media/a.mp4' },
          { type: 'html', html: '<table><tr><td>复杂表格原文</td></tr></table>' },
          { type: 'sandbox', html: '<div>沙箱可见原文</div><script>localAdapter()</script>' },
          { type: 'stepSimulation', title: '', steps: [{ prompt: '步骤原题', options: ['选项甲', '选项乙'], answerIndex: 2 }] },
        ],
      },
    },
    knowledgePoints: {},
  }), 'utf8');
  const result = spawnSync(process.execPath, [verifier, path.join(fixture, 'source.html'), course], { encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  console.log('fidelity-media: ok');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
