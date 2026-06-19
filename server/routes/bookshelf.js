// routes/bookshelf.js - per-user saved courses (bookshelf), keyed by course_key.
import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { bookshelfDb } from '../db-bookshelf.js';

export const bookshelfRouter = Router();
bookshelfRouter.use(requireUser);   // every bookshelf endpoint requires sign-in

// GET / - list the caller's saved courses.
bookshelfRouter.get('/', (req, res) => {
  res.json({ items: bookshelfDb.list(req.user.id) });
});

// PUT /:key - add a course to the caller's bookshelf.
bookshelfRouter.put('/:key', (req, res) => {
  bookshelfDb.add({ userId: req.user.id, courseKey: req.params.key, now: Date.now() });
  res.json({ ok: true });
});

// DELETE /:key - remove a course from the caller's bookshelf.
bookshelfRouter.delete('/:key', (req, res) => {
  bookshelfDb.remove(req.user.id, req.params.key);
  res.json({ ok: true });
});
