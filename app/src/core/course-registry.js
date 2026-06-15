// course-registry.js — 课程登记表:内置课程清单 + 本地上传课程(IndexedDB)。
//
// 内置课程随站发布(dist-courses 下的 .pigeon,通过 URL 加载)。
// 用户上传的课程包字节存入 IndexedDB(图片大,localStorage 放不下),
// 课程元信息(用于首页卡片)同时存一份索引,便于快速渲染列表。
//
// 学习页通过 ?course=<id> 找到课程来源:内置走 URL,本地走 IndexedDB。

const DB_NAME = 'pglib-courses';
const DB_VERSION = 1;
const STORE = 'packages'; // { id, name, bytes(ArrayBuffer), meta, addedAt }

// 内置课程:随站发布。base 由调用方传入(支持子路径部署)。
export const BUILTIN_COURSES = [
  {
    id: 'ic-packaging',
    url: 'courses/ic-packaging.pigeon',
    title: 'IC封装技术',
    subtitle: '集创赛备考 · 微电子封装工艺',
    builtin: true,
  },
];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/** 保存一个上传的课程包(字节 + 元信息)。同 id 覆盖。 */
export async function saveLocalCourse({ id, bytes, meta }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const store = tx(db, 'readwrite');
    const req = store.put({ id, bytes, meta, addedAt: Date.now() });
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/** 列出全部本地课程的元信息(不含字节,供首页卡片渲染)。 */
export async function listLocalCourses() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = tx(db, 'readonly').openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        const { id, meta, addedAt } = cur.value;
        out.push({ id, meta, addedAt, builtin: false });
        cur.continue();
      } else {
        out.sort((a, b) => b.addedAt - a.addedAt);
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/** 取某个本地课程的完整记录(含字节,供学习页加载)。 */
export async function getLocalCourse(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/** 删除一个本地课程。 */
export async function deleteLocalCourse(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(db, 'readwrite').delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export function findBuiltin(id) {
  return BUILTIN_COURSES.find((c) => c.id === id) || null;
}
