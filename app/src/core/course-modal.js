// course-modal.js — 课程详情弹层:简介 / 统计 / 评分 / 下载量 / 评论区 / 加入书架 / 开始学习。
// 广场卡片与个人主页共用。社交数据按 course_key 取(内置课也可被评分 / 评论 / 收藏)。
// 隐私边界:评论区显示用户名 = 发言人自愿公开;不在此展示任何「被学习者」的个体行为数据。
import { icon } from './icons.js';
import { toast } from './toast.js';
import { isLoggedIn, getUser, isAdmin } from './session.js';
import { promptLogin } from './auth-ui.js';
import {
  getSocial, setRating, listComments, addComment, deleteComment,
  addToShelf, removeFromShelf,
} from './course-source.js';

let overlay = null;
let current = null; // { card, opts, social, shelved, comments, nextBefore, loading }

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function timeText(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'detail-overlay';
  overlay.hidden = true;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCourseDetail(); });
  document.body.appendChild(overlay);
  return overlay;
}

export function closeCourseDetail() {
  if (overlay) overlay.hidden = true;
  current = null;
}

// 打开课程详情弹层。
//  card: 归一化课程对象(courseKey/title/subtitle/author/publisherName/category/stats/coverDataUrl/source/serverId)
//  opts: { onStart(card), shelved:boolean, onShelfChange(courseKey, added) }
export async function openCourseDetail(card, opts = {}) {
  ensureOverlay();
  current = {
    card, opts, social: null, shelved: !!opts.shelved,
    comments: [], nextBefore: null, loading: true,
  };
  overlay.hidden = false;
  render();
  const [social, comments] = await Promise.all([
    getSocial(card.courseKey),
    listComments(card.courseKey),
  ]);
  if (!current || current.card.courseKey !== card.courseKey) return; // 期间已关闭/切换
  current.social = social;
  current.comments = comments.items || [];
  current.nextBefore = comments.nextBefore || null;
  current.loading = false;
  render();
}

// ---- 评分星 ----
function starsStatic(avg) {
  const n = Math.round(Number(avg) || 0);
  let out = `<span class="course-stars" aria-label="平均 ${avg} 星">`;
  for (let i = 1; i <= 5; i += 1) out += `<span class="star ${i <= n ? 'filled' : ''}">${icon('star', { size: 15 })}</span>`;
  out += '</span>';
  return out;
}

function starsInteractive(my) {
  let out = '<div class="rate-stars" role="radiogroup" aria-label="我的评分">';
  for (let i = 1; i <= 5; i += 1) {
    out += `<button class="star rate-star ${my && i <= my ? 'filled' : ''}" type="button" data-score="${i}" aria-label="${i} 星" aria-checked="${my === i}">${icon('star', { size: 22 })}</button>`;
  }
  out += '</div>';
  return out;
}

function renderComments() {
  const list = current.comments;
  if (!list.length) return '<p class="detail-empty">还没有评论,来做第一个吧。</p>';
  const me = getUser();
  const admin = isAdmin();
  return list.map((c) => {
    const canDel = me && (c.user_id === me.id || admin);
    return `
      <li class="comment" data-cid="${c.id}">
        <div class="comment-head">
          <span class="comment-name">${esc(c.username || '已注销')}</span>
          <span class="comment-time">${timeText(c.created_at)}</span>
          ${canDel ? `<button class="comment-del" type="button" data-act="del-comment" data-cid="${c.id}" aria-label="删除评论">${icon('trash-2', { size: 14 })}</button>` : ''}
        </div>
        <p class="comment-body">${esc(c.body)}</p>
      </li>`;
  }).join('');
}

function render() {
  if (!current) return;
  const { card, social, shelved, loading } = current;
  const s = card.stats || {};
  const cover = card.coverDataUrl || '';
  const publisher = card.publisherName || card.author || '未署名';
  const ratingLine = social
    ? `${starsStatic(social.avgRating)} <span class="detail-metric-num">${social.avgRating || '—'}</span> <span class="detail-metric-sub">(${social.ratingCount} 人评分)</span>`
    : '<span class="detail-metric-sub">加载中…</span>';
  const loggedIn = isLoggedIn();

  overlay.innerHTML = `
    <div class="detail-modal" role="dialog" aria-modal="true" aria-label="${esc(card.title)}">
      <button class="detail-close" type="button" data-act="close" aria-label="关闭">${icon('x', { size: 18 })}</button>
      <div class="detail-head">
        <div class="detail-cover ${cover ? 'has-image' : ''}" ${cover ? `style="background-image:url('${cover}')"` : ''} aria-hidden="true">${cover ? '' : `<span>${esc((card.title || '?').slice(0, 1))}</span>`}</div>
        <div class="detail-headinfo">
          <span class="course-badge">${esc(publisher)}</span>
          ${card.category ? `<span class="course-cat">${esc(card.category)}</span>` : ''}
          <h2 class="detail-title">${esc(card.title)}</h2>
          <p class="detail-subtitle">${esc(card.subtitle || '')}</p>
          <p class="detail-stats">
            <span>${icon('book', { size: 13 })} ${s.chapters || 0} 章</span>
            <span>${icon('bookmark', { size: 13 })} ${s.knowledgePoints || 0} 知识点</span>
            <span>${icon('square-pen', { size: 13 })} ${s.questions || 0} 题</span>
            ${social ? `<span>${icon('download', { size: 13 })} ${social.downloadCount} 人学习</span>` : ''}
          </p>
        </div>
      </div>

      <div class="detail-intro">
        <p class="detail-section-title">课程简介</p>
        <p class="detail-intro-body">${esc(card.description || card.subtitle || '作者暂未填写课程简介。')}</p>
      </div>

      <div class="detail-actions">
        <button class="btn btn-primary" type="button" data-act="start">开始学习 ▸</button>
        <button class="btn btn-secondary" type="button" data-act="toggle-shelf">${shelved ? '移出书架' : '加入书架'}</button>
      </div>

      <div class="detail-rate">
        <p class="detail-section-title">课程评分</p>
        <p class="detail-rating-avg">${ratingLine}</p>
        ${loggedIn
    ? `<p class="detail-rate-mine">我的评分:${starsInteractive(social ? social.myRating : null)}</p>`
    : '<p class="detail-rate-mine detail-hint">登录后可评分</p>'}
      </div>

      <div class="detail-comments">
        <p class="detail-section-title">评论 ${social ? `<span class="detail-metric-sub">(${social.commentCount})</span>` : ''}</p>
        ${loggedIn
    ? `<form class="comment-form" data-act="add-comment">
            <textarea name="body" maxlength="1000" rows="2" placeholder="写下你的看法(发布后即时可见,不实内容可被作者或管理员删除)"></textarea>
            <button class="btn btn-primary" type="submit">发表评论</button>
          </form>`
    : '<p class="detail-hint">登录后可发表评论</p>'}
        <ul class="comment-list">${loading ? '<li class="detail-empty">加载中…</li>' : renderComments()}</ul>
        ${current.nextBefore ? '<button class="btn btn-secondary detail-more" type="button" data-act="more-comments">加载更多</button>' : ''}
      </div>
    </div>`;

  bind();
}

function bind() {
  const modal = overlay.querySelector('.detail-modal');
  if (!modal) return;

  modal.addEventListener('click', async (e) => {
    // 评分星按钮只有 data-score、无 data-act,必须在 data-act 早退之前判定,否则永远点不动。
    const star = e.target.closest('.rate-star');
    if (star) return rate(Number(star.dataset.score));
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') return closeCourseDetail();
    if (act === 'start') {
      current.opts.onStart?.(current.card);
      return;
    }
    if (act === 'toggle-shelf') return toggleShelf(t);
    if (act === 'del-comment') return delComment(Number(t.dataset.cid));
    if (act === 'more-comments') return loadMore();
  });

  const form = modal.querySelector('.comment-form');
  if (form) form.addEventListener('submit', (e) => { e.preventDefault(); postComment(form); });
}

async function rate(score) {
  if (!isLoggedIn()) return promptLogin();
  const fresh = await setRating(current.card.courseKey, score);
  if (fresh) {
    current.social = fresh;
    render();
    toast('已评分', { type: 'success' });
  } else {
    toast('评分失败', { type: 'error' });
  }
}

async function toggleShelf(btn) {
  if (!isLoggedIn()) return promptLogin();
  btn.disabled = true;
  const key = current.card.courseKey;
  const r = current.shelved ? await removeFromShelf(key) : await addToShelf(key);
  if (r.needLogin) { btn.disabled = false; return promptLogin(); }
  if (r.ok) {
    current.shelved = !current.shelved;
    current.opts.onShelfChange?.(key, current.shelved);
    toast(current.shelved ? '已加入书架' : '已移出书架', { type: 'success' });
    render();
  } else {
    btn.disabled = false;
    toast('操作失败', { type: 'error' });
  }
}

async function postComment(form) {
  const body = form.body.value.trim();
  if (!body) return;
  const btn = form.querySelector('button');
  btn.disabled = true;
  const r = await addComment(current.card.courseKey, body);
  btn.disabled = false;
  if (r.needLogin) return promptLogin();
  if (r.ok && r.comment) {
    current.comments.unshift(r.comment);
    if (current.social) current.social.commentCount += 1;
    render();
    toast('已发表', { type: 'success' });
  } else {
    toast(r.error || '发表失败', { type: 'error' });
  }
}

async function delComment(cid) {
  const r = await deleteComment(cid);
  if (r.ok) {
    current.comments = current.comments.filter((c) => c.id !== cid);
    if (current.social && current.social.commentCount > 0) current.social.commentCount -= 1;
    render();
    toast('已删除', { type: 'info' });
  } else {
    toast('删除失败', { type: 'error' });
  }
}

async function loadMore() {
  const r = await listComments(current.card.courseKey, current.nextBefore);
  current.comments.push(...(r.items || []));
  current.nextBefore = r.nextBefore || null;
  render();
}
