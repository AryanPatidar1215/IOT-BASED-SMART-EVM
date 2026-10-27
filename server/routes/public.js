const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { c } = require('../db');
const { asyncH } = require('../util');

const limiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many checks. Wait a minute.' } });

const publicCandidates = (e) => e.candidates.map(({ no, name, symbol, color }) => ({ no, name, symbol, color }));

router.get('/election', asyncH(async (req, res) => {
  const e = await c.election.findOne({ _id: 'current' });
  const [registered, voted] = await Promise.all([
    c.voters.countDocuments({ registered: true }),
    c.voters.countDocuments({ hasVoted: true })
  ]);
  res.json({ title: e.title, status: e.status, candidates: publicCandidates(e), registered, voted, openedAt: e.openedAt || null, closedAt: e.closedAt || null });
}));

router.get('/results', asyncH(async (req, res) => {
  const e = await c.election.findOne({ _id: 'current' });
  if (e.status !== 'closed') return res.status(403).json({ sealed: true, error: 'Results stay sealed until the election closes.' });
  const rows = await c.votes.aggregate([{ $group: { _id: '$option', n: { $sum: 1 } } }]).toArray();
  const byNo = Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const candidates = publicCandidates(e).map((cd) => ({ ...cd, votes: byNo[cd.no] || 0 }));
  const total = candidates.reduce((a, x) => a + x.votes, 0);
  res.json({ title: e.title, total, candidates });
}));

router.get('/receipt/:code', limiter, asyncH(async (req, res) => {
  const code = String(req.params.code || '').toUpperCase().trim();
  if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) return res.status(400).json({ error: 'A receipt looks like K7F-29Q.' });
  const found = await c.votes.findOne({ receipt: code }, { projection: { _id: 1 } });
  res.json({ counted: !!found });
}));

module.exports = router;
