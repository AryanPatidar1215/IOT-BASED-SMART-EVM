const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');
const config = require('../config');
const { c } = require('../db');
const audit = require('../services/audit');
const { adminAuth } = require('../middleware/auth');
const { asyncH, httpError } = require('../util');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' }
});

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', loginLimiter, asyncH(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 40);
  const password = String(req.body.password || '').slice(0, 200);
  const admin = username ? await c.admins.findOne({ username }) : null;
  const ok = await bcrypt.compare(password, admin ? admin.passwordHash : DUMMY_HASH);

  if (!admin || !ok) {
    await audit.append('system', 'login failed', 'username "' + username.replace(/[^a-z0-9._-]/g, '?') + '"');
    return res.status(401).json({ error: 'Wrong username or password.' });
  }

  const token = jwt.sign({ username: admin.username }, config.jwtSecret, {
    subject: String(admin._id),
    expiresIn: config.sessionHours + 'h'
  });
  res.cookie('evm_admin', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSecure,
    maxAge: config.sessionHours * 3600 * 1000
  });
  await audit.append(admin.username, 'login', 'admin signed in');
  res.json({ username: admin.username });
}));

router.post('/logout', (req, res) => {
  res.clearCookie('evm_admin');
  res.json({ ok: true });
});

router.get('/me', adminAuth, (req, res) => res.json({ username: req.admin.username }));

router.post('/change-password', adminAuth, loginLimiter, asyncH(async (req, res) => {
  const current = String(req.body.current || '');
  const next = String(req.body.next || '');
  if (next.length < 10) throw httpError(400, 'Use at least 10 characters for the new password.');
  const admin = await c.admins.findOne({ _id: new ObjectId(req.admin.id) });
  if (!admin || !(await bcrypt.compare(current, admin.passwordHash))) throw httpError(403, 'Your current password is wrong.');
  await c.admins.updateOne({ _id: admin._id }, { $set: { passwordHash: await bcrypt.hash(next, 12), passwordChangedAt: new Date() } });
  await audit.append(admin.username, 'password changed', 'admin password updated');
  res.json({ ok: true });
}));

module.exports = router;
