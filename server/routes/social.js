// routes/social.js - per-course ratings and comments, keyed by course_key.
import { Router } from 'express';
import { requireUser, authError, currentUser } from '../middleware/auth.js';
import { socialDb } from '../db-social.js';

export const socialRouter = Router();

// GET /:key/social - public aggregate (avg rating, counts) plus the caller's own rating when signed in.
socialRouter.get('/:key/social', (req, res) => {
  const user = currentUser(req);
  res.json(socialDb.getSocial(req.params.key, user ? user.id : null));
});

// PUT /:key/rating - upsert the caller's 1-5 rating, then return refreshed social aggregates.
socialRouter.put('/:key/rating', requireUser, (req, res) => {
  const score = Number(req.body.score);
  socialDb.setRating({ courseKey: req.params.key, userId: req.user.id, score, now: Date.now() });
  res.json(socialDb.getSocial(req.params.key, req.user.id));
});

// GET /:key/comments - public, keyset-paginated comment list (newest first).
socialRouter.get('/:key/comments', (req, res) => {
  const before = req.query.before ? Number(req.query.before) : null;
  res.json(socialDb.listComments({ courseKey: req.params.key, before }));
});

// POST /:key/comments - add a comment for the signed-in user.
socialRouter.post('/:key/comments', requireUser, (req, res) => {
  const row = socialDb.addComment({
    courseKey: req.params.key,
    userId: req.user.id,
    username: req.user.username,
    body: req.body.body,
    now: Date.now(),
  });
  if (!row) return authError(res, 400, 'bad_request', '评论内容为空');
  res.json({ comment: row });
});

// DELETE /comment/:cid - hide a comment. Allowed for its author or an admin.
socialRouter.delete('/comment/:cid', requireUser, (req, res) => {
  const c = socialDb.commentById(Number(req.params.cid));
  if (!c) return authError(res, 404, 'not_found', 'comment not found');
  if (c.user_id !== req.user.id && req.user.role !== 'admin') {
    return authError(res, 403, 'forbidden', 'not allowed to delete this comment');
  }
  socialDb.hideComment(c.id);
  res.json({ ok: true });
});
