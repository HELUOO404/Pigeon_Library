// config.js — 集中读取环境变量并给出默认值。真实密钥/口令由用户在 .env 配置,代码不内置。
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));

// 极简 .env 解析(避免引入 dotenv 依赖):KEY=VALUE 行,# 注释,去引号。
function loadDotEnv() {
  const envPath = path.join(here, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadDotEnv();

const DATA_DIR = path.join(here, 'data');

export const config = {
  port: Number(process.env.PORT) || 8787,
  isProd: process.env.NODE_ENV === 'production',
  sessionTtlMs: (Number(process.env.SESSION_TTL_DAYS) || 30) * 24 * 60 * 60 * 1000,
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',').map((s) => s.trim()).filter(Boolean),
  seedAdminUser: process.env.SEED_ADMIN_USER || '',
  seedAdminPass: process.env.SEED_ADMIN_PASS || '',
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'pglib.db'),
  coursesDir: path.join(DATA_DIR, 'courses'),  // 课程包文件存储根目录
  cookieName: 'pglib_sess',
  bcryptRounds: 10,
  maxStateBytes: 256 * 1024,        // 单 slot data_json 上限
  maxPigeonBytes: 50 * 1024 * 1024, // 单个 .pigeon 上传上限(与格式上限一致)
  authRateWindowMs: 60 * 1000,
  authRateMax: 20,                  // 每 IP 每窗口的认证请求上限
};

// 合法 slot 枚举(与前端 store 对齐)。
export const SLOTS = ['progress', 'quiz', 'wrong', 'studyTime', 'theme', 'localCourses'];

// 课程广场预设分类(发布时选其一;非法值回退「其他」)。前端另有一份对齐副本。
export const COURSE_CATEGORIES = ['电子/集成电路', '材料/工艺', '计算机/软件', '数理基础', '通用/综合', '其他'];
