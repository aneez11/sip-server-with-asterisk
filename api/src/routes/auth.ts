import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { loginSchema } from '../validation/schemas.js';
import { ApiError } from '../errors.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: body.username } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      throw new ApiError(401, 'Invalid credentials');
    }
    req.session.userId = user.id;
    // Await the write before responding: the client navigates (and re-requests
    // /api/auth/me) immediately after login, and an unawaited save can lose that
    // race against the MySQL session store, yielding a spurious 401.
    await new Promise<void>((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );
    res.json({ ok: true, user: { id: user.id, username: user.username, displayName: user.displayName } });
  } catch (e) {
    if (e instanceof ApiError) return res.status(e.status).json({ message: e.message });
    if (e instanceof Error) return res.status(422).json({ message: e.message });
    next(e);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ message: 'Not authenticated' });
  res.json({ ok: true, userId: req.session.userId });
});

export default router;