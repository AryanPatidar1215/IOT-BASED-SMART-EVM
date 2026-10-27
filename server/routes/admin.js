const router = require('express').Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { ObjectId } = require('mongodb');
const config = require('../config');
const { c } = require('../db');
const audit = require('../services/audit');
const events = require('../services/events');
const enroll = require('../services/enroll');
const { adminAuth, confirmPassword, sha256 } = require('../middleware/auth');
const { asyncH, normUid, escapeRegex, httpError } = require('../util');

router.use(adminAuth);

const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password checks. Try again in 15 minutes.' }
});

const toId = (s) => {
  try { return new ObjectId(String(s)); } catch { throw httpError(400, 'Invalid id.'); }
};

router.get('/stream', (req, res) => events.subscribe(req, res));

/* ---------- Overview ---------- */
router.get('/stats', asyncH(async (req, res) => {
  const election = await c.election.findOne({ _id: 'current' });
  const online = Date.now() - config.deviceOnlineMs;

  const [registered, blocked, voted, votesCast, timeline, byBooth, devicesTotal, devicesOnline] = await Promise.all([
    c.voters.countDocuments({ registered: true }),
    c.voters.countDocuments({ registered: false }),
    c.voters.countDocuments({ hasVoted: true }),
    c.votes.countDocuments({}),
    c.votes.aggregate([{ $group: { _id: '$castAt', n: { $sum: 1 } } }, { $sort: { _id: 1 } }]).toArray(),
    c.votes.aggregate([{ $group: { _id: '$boothId', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray(),
    c.devices.countDocuments({ active: true }),
    c.devices.countDocuments({ active: true, lastSeen: { $gt: new Date(online) } })
  ]);

  const out = {
    election: { title: election.title, status: election.status, candidates: election.candidates, openedAt: election.openedAt || null, closedAt: election.closedAt || null },
    registered, blocked, voted, votesCast,
    mismatch: voted !== votesCast,
    timeline: timeline.map((t) => ({ at: t._id, n: t.n })),
    byBooth: byBooth.map((b) => ({ booth: b._id, n: b.n })),
    devices: { total: devicesTotal, online: devicesOnline },
    results: null
  };

  if (election.status === 'closed') {
    const rows = await c.votes.aggregate([{ $group: { _id: '$option', n: { $sum: 1 } } }]).toArray();
    const byNo = Object.fromEntries(rows.map((r) => [r._id, r.n]));
    out.results = election.candidates.map((cd) => ({ ...cd, votes: byNo[cd.no] || 0 }));
  }
  res.json(out);
}));

/* ---------- Voters (registration needs the admin's password) ---------- */
function cleanVoter(input) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ');
  const voterId = String(input.voterId || '').trim().toUpperCase();
  const uidRaw = String(input.uid || '').trim();
  const uid = uidRaw ? normUid(uidRaw) : null;
  if (name.length < 2 || name.length > 60) throw httpError(400, 'Enter the voter name (2 to 60 characters).');
  if (!/^[A-Z0-9][A-Z0-9\-_/]{2,29}$/.test(voterId)) throw httpError(400, 'Voter ID needs 3 to 30 letters, numbers, dashes or slashes.');
  if (uidRaw && !uid) throw httpError(400, 'Card UID must be 8 to 20 hex characters, like 4A7F21C9.');
  return { name, voterId, uid };
}

router.get('/voters', asyncH(async (req, res) => {
  const q = {};
  const search = String(req.query.search || '').trim().slice(0, 40);
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    q.$or = [{ name: rx }, { voterId: rx }, { uid: rx }];
  }
  const status = String(req.query.status || '');
  if (status === 'voted') q.hasVoted = true;
  if (status === 'pending') { q.hasVoted = false; q.registered = true; }
  if (status === 'blocked') q.registered = false;

  const voters = await c.voters
    .find(q, { projection: { name: 1, voterId: 1, uid: 1, registered: 1, hasVoted: 1, createdAt: 1, createdBy: 1 } })
    .sort({ createdAt: -1 }).limit(1000).toArray();
  res.json({ voters });
}));

router.post('/voters', sensitiveLimiter, asyncH(async (req, res) => {
  await confirmPassword(req);
  const election = await c.election.findOne({ _id: 'current' });
  if (election.status === 'closed') throw httpError(409, 'The election is closed. Voters can no longer be added.');
  const v = cleanVoter(req.body);
  if (!v.uid) throw httpError(400, 'Enter the card UID, or use "Scan at booth" to capture it.');
  try {
    await c.voters.insertOne({ ...v, registered: true, hasVoted: false, createdAt: new Date(), createdBy: req.admin.username, via: 'admin panel' });
  } catch (e) {
    if (e.code === 11000) throw httpError(409, 'That card or voter ID is already registered.');
    throw e;
  }
  await audit.append(req.admin.username, 'voter added', `voter ${v.voterId}, card ${'****' + v.uid.slice(-4)}`);
  events.emit('voters', {});
  res.status(201).json({ ok: true });
}));

router.post('/voters/bulk', sensitiveLimiter, asyncH(async (req, res) => {
  await confirmPassword(req);
  const election = await c.election.findOne({ _id: 'current' });
  if (election.status === 'closed') throw httpError(409, 'The election is closed. Voters can no longer be added.');
  const rows = Array.isArray(req.body.rows) ? req.body.rows.slice(0, 500) : [];
  if (!rows.length) throw httpError(400, 'Paste at least one row.');
  let added = 0;
  const skipped = [];
  for (const [i, row] of rows.entries()) {
    try {
      const v = cleanVoter(row);
      if (!v.uid) throw httpError(400, 'Missing card UID.');
      await c.voters.insertOne({ ...v, registered: true, hasVoted: false, createdAt: new Date(), createdBy: req.admin.username, via: 'bulk import' });
      added++;
    } catch (e) {
      skipped.push({ row: i + 1, reason: e.code === 11000 ? 'Already registered.' : e.message });
    }
  }
  await audit.append(req.admin.username, 'voters imported', `${added} added, ${skipped.length} skipped`);
  events.emit('voters', {});
  res.json({ added, skipped });
}));

router.patch('/voters/:id', asyncH(async (req, res) => {
  const registered = req.body.registered === true;
  const r = await c.voters.findOneAndUpdate({ _id: toId(req.params.id) }, { $set: { registered } }, { projection: { voterId: 1 } });
  if (!r) throw httpError(404, 'Voter not found.');
  await audit.append(req.admin.username, registered ? 'voter unblocked' : 'voter blocked', 'voter ' + r.voterId);
  events.emit('voters', {});
  res.json({ ok: true });
}));

router.delete('/voters/:id', asyncH(async (req, res) => {
  const voter = await c.voters.findOne({ _id: toId(req.params.id) });
  if (!voter) throw httpError(404, 'Voter not found.');
  if (voter.hasVoted) throw httpError(409, 'This voter has already voted. Block them instead of deleting.');
  await c.voters.deleteOne({ _id: voter._id });
  await audit.append(req.admin.username, 'voter removed', 'voter ' + voter.voterId);
  events.emit('voters', {});
  res.json({ ok: true });
}));

/* ---------- Enrollment: capture a card at the booth ---------- */
router.post('/enroll', sensitiveLimiter, asyncH(async (req, res) => {
  await confirmPassword(req);
  const election = await c.election.findOne({ _id: 'current' });
  if (election.status === 'closed') throw httpError(409, 'The election is closed. Voters can no longer be added.');
  const v = cleanVoter({ ...req.body, uid: '' });
  const s = enroll.start({ name: v.name, voterId: v.voterId, by: req.admin.username });
  await audit.append(req.admin.username, 'enrollment armed', `voter ${v.voterId}, 60 second window`);
  res.json({ active: true, expiresAt: s.expiresAt });
}));

router.get('/enroll', (req, res) => {
  const s = enroll.active();
  res.json({ active: !!s, expiresAt: s ? s.expiresAt : null, name: s ? s.name : null, voterId: s ? s.voterId : null, result: enroll.getResult() });
});

router.delete('/enroll', asyncH(async (req, res) => {
  enroll.clear();
  await audit.append(req.admin.username, 'enrollment cancelled', 'no card was captured');
  res.json({ ok: true });
}));

/* ---------- Election ---------- */
router.get('/election', asyncH(async (req, res) => {
  res.json(await c.election.findOne({ _id: 'current' }, { projection: { _id: 0 } }));
}));

router.put('/election', asyncH(async (req, res) => {
  const e = await c.election.findOne({ _id: 'current' });
  if (e.status !== 'draft') throw httpError(409, 'The ballot is locked once the election opens.');
  const title = String(req.body.title || '').trim();
  const input = Array.isArray(req.body.candidates) ? req.body.candidates : [];
  if (title.length < 3 || title.length > 80) throw httpError(400, 'Give the election a title (3 to 80 characters).');
  if (input.length < 2 || input.length > 4) throw httpError(400, 'A ballot needs 2 to 4 candidates, one per booth button.');
  const colors = ['#e4e2da', '#d64545', '#e6b422', '#3f9d5a'];
  const seen = new Set();
  const candidates = input.map((cd, i) => {
    const name = String(cd.name || '').trim().replace(/\s+/g, ' ');
    const symbol = String(cd.symbol || '').trim().slice(0, 2).toUpperCase() || String.fromCharCode(65 + i);
    if (name.length < 2 || name.length > 40) throw httpError(400, `Candidate ${i + 1} needs a name (2 to 40 characters).`);
    if (seen.has(name.toLowerCase())) throw httpError(400, 'Each candidate needs a different name.');
    seen.add(name.toLowerCase());
    return { no: i + 1, name, symbol, color: colors[i] };
  });
  await c.election.updateOne({ _id: 'current' }, { $set: { title, candidates } });
  await audit.append(req.admin.username, 'ballot updated', `${candidates.length} candidates`);
  events.emit('election', {});
  res.json({ ok: true });
}));

router.post('/election/open', asyncH(async (req, res) => {
  const e = await c.election.findOne({ _id: 'current' });
  if (e.status !== 'draft') throw httpError(409, 'The election is already ' + e.status + '.');
  if (!(await c.voters.countDocuments({ registered: true }))) throw httpError(409, 'Add at least one voter before opening.');
  await c.election.updateOne({ _id: 'current' }, { $set: { status: 'open', openedAt: new Date() } });
  await audit.append(req.admin.username, 'election opened', e.title);
  events.emit('election', { status: 'open' });
  res.json({ ok: true });
}));

router.post('/election/close', asyncH(async (req, res) => {
  const e = await c.election.findOne({ _id: 'current' });
  if (e.status !== 'open') throw httpError(409, 'Only an open election can be closed.');
  await c.election.updateOne({ _id: 'current' }, { $set: { status: 'closed', closedAt: new Date() } });
  const votes = await c.votes.countDocuments({});
  await audit.append(req.admin.username, 'election closed', `${votes} votes recorded, results unsealed`);
  events.emit('election', { status: 'closed' });
  res.json({ ok: true });
}));

router.post('/election/reset', sensitiveLimiter, asyncH(async (req, res) => {
  await confirmPassword(req);
  const e = await c.election.findOne({ _id: 'current' });
  if (e.status !== 'closed') throw httpError(409, 'Only a closed election can be reset.');
  await c.votes.deleteMany({});
  await c.voters.updateMany({}, { $set: { hasVoted: false }, $unset: { votedAt: '' } });
  await c.election.updateOne({ _id: 'current' }, { $set: { status: 'draft' }, $unset: { openedAt: '', closedAt: '' } });
  await audit.append(req.admin.username, 'election reset', 'votes cleared, voters can vote again');
  events.emit('election', { status: 'draft' });
  res.json({ ok: true });
}));

/* ---------- Booths ---------- */
router.get('/devices', asyncH(async (req, res) => {
  const devices = await c.devices.find({}, { projection: { keyHash: 0 } }).sort({ createdAt: -1 }).toArray();
  const now = Date.now();
  res.json({
    devices: devices.map((d) => ({
      deviceId: d.deviceId, name: d.name, active: d.active, ip: d.ip || null, rssi: d.rssi ?? null, fw: d.fw || null,
      lastSeen: d.lastSeen || null, online: !!(d.active && d.lastSeen && now - d.lastSeen.getTime() < config.deviceOnlineMs)
    }))
  });
}));

router.post('/devices', asyncH(async (req, res) => {
  const name = String(req.body.name || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 30) throw httpError(400, 'Name the booth (2 to 30 characters).');
  const deviceId = 'booth-' + crypto.randomBytes(3).toString('hex');
  const key = crypto.randomBytes(24).toString('hex');
  await c.devices.insertOne({ deviceId, name, keyHash: sha256(key), active: true, createdAt: new Date(), createdBy: req.admin.username });
  await audit.append(req.admin.username, 'booth added', `${name} (${deviceId})`);
  events.emit('device', {});
  res.status(201).json({ deviceId, key });
}));

router.delete('/devices/:deviceId', asyncH(async (req, res) => {
  const r = await c.devices.findOneAndUpdate({ deviceId: String(req.params.deviceId) }, { $set: { active: false } });
  if (!r) throw httpError(404, 'Booth not found.');
  await audit.append(req.admin.username, 'booth revoked', `${r.name} (${r.deviceId})`);
  events.emit('device', {});
  res.json({ ok: true });
}));

/* ---------- Audit ---------- */
router.get('/audit', asyncH(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json({ entries: await audit.list(limit) });
}));

router.get('/audit/verify', asyncH(async (req, res) => res.json(await audit.verify())));

module.exports = router;
