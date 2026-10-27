const router = require('express').Router();
const crypto = require('crypto');
const { c } = require('../db');
const audit = require('../services/audit');
const events = require('../services/events');
const enroll = require('../services/enroll');
const { deviceAuth } = require('../middleware/auth');
const { asyncH, normUid, maskUid, bucket5, receiptCode } = require('../util');

router.use(deviceAuth);

router.post('/heartbeat', asyncH(async (req, res) => {
  const rssi = Number(req.body.rssi);
  const fw = String(req.body.fw || '').slice(0, 20);
  await c.devices.updateOne(
    { deviceId: req.device.deviceId },
    { $set: { rssi: Number.isFinite(rssi) ? rssi : null, fw } }
  );
  events.emit('device', { deviceId: req.device.deviceId });
  const election = await c.election.findOne({ _id: 'current' });
  res.json({ ok: true, election: election.status });
}));

router.post('/check-voter', asyncH(async (req, res) => {
  const uid = normUid(req.body.uid);
  const booth = req.device.name;
  if (!uid) return res.status(400).json({ eligible: false, code: 'INVALID', message: 'Invalid card' });

  const enr = enroll.active();
  if (enr) {
    try {
      await c.voters.insertOne({
        uid, name: enr.name, voterId: enr.voterId,
        registered: true, hasVoted: false,
        createdAt: new Date(), createdBy: enr.by, via: 'booth ' + booth
      });
    } catch (e) {
      if (e.code === 11000) {
        events.emit('activity', { kind: 'warn', text: `Enrollment failed at ${booth}: this card or voter ID is already registered.` });
        return res.json({ eligible: false, code: 'DUPLICATE_CARD', message: 'Card or ID already registered' });
      }
      throw e;
    }
    enroll.setResult({ ok: true, name: enr.name, voterId: enr.voterId, card: maskUid(uid) });
    enroll.clear();
    await audit.append(enr.by, 'voter enrolled', `voter ${enr.voterId} registered through ${booth}, card ${maskUid(uid)}`);
    events.emit('enrolled', { voterId: enr.voterId });
    events.emit('activity', { kind: 'good', text: `${enr.name} was registered at ${booth}.` });
    return res.json({ eligible: false, code: 'ENROLLED', message: 'Card enrolled' });
  }

  const election = await c.election.findOne({ _id: 'current' });
  if (election.status !== 'open') {
    return res.json({ eligible: false, code: 'NOT_OPEN', message: 'Election is not open' });
  }

  const voter = await c.voters.findOne({ uid });
  if (!voter) {
    await audit.append('booth:' + booth, 'card rejected', 'unregistered card ' + maskUid(uid));
    events.emit('activity', { kind: 'bad', text: `${booth} rejected an unregistered card (${maskUid(uid)}).` });
    return res.json({ eligible: false, code: 'NOT_REGISTERED', message: 'Card is not registered' });
  }
  if (!voter.registered) {
    await audit.append('booth:' + booth, 'card rejected', 'blocked card ' + maskUid(uid));
    events.emit('activity', { kind: 'bad', text: `${booth} rejected a blocked card (${maskUid(uid)}).` });
    return res.json({ eligible: false, code: 'BLOCKED', message: 'Card is blocked' });
  }
  if (voter.hasVoted) {
    await audit.append('booth:' + booth, 'duplicate attempt', 'second vote attempt with card ' + maskUid(uid));
    events.emit('activity', { kind: 'warn', text: `${booth} blocked a second vote attempt (${maskUid(uid)}).` });
    return res.json({ eligible: false, code: 'ALREADY_VOTED', message: 'Already voted' });
  }

  events.emit('activity', { kind: 'info', text: `${booth} accepted a card. Waiting for the voter to choose.` });
  res.json({ eligible: true, code: 'OK', message: 'Card accepted' });
}));

router.post('/vote', asyncH(async (req, res) => {
  const uid = normUid(req.body.uid);
  const option = Number(req.body.option);
  let reqId = String(req.body.reqId || '').toLowerCase();
  if (!/^[0-9a-f]{8,64}$/.test(reqId)) reqId = crypto.randomBytes(8).toString('hex');
  const booth = req.device.name;

  const election = await c.election.findOne({ _id: 'current' });
  if (!uid || !Number.isInteger(option) || option < 1 || option > election.candidates.length) {
    return res.status(400).json({ success: false, code: 'INVALID', message: 'Invalid card or option' });
  }

  // A retried request (same reqId) gets the original receipt instead of a second vote.
  const prior = await c.votes.findOne({ reqId });
  if (prior) return res.json({ success: true, code: 'OK', receipt: prior.receipt, duplicate: true });

  if (election.status !== 'open') {
    return res.status(409).json({ success: false, code: 'NOT_OPEN', message: 'Election is not open' });
  }

  // Step 1: atomically claim the voter. Only a registered, not-yet-voted card passes.
  const claim = await c.voters.updateOne(
    { uid, registered: true, hasVoted: false },
    { $set: { hasVoted: true, votedAt: bucket5(new Date()) } }
  );
  if (claim.modifiedCount !== 1) {
    const voter = await c.voters.findOne({ uid });
    const code = !voter || !voter.registered ? 'NOT_REGISTERED' : 'ALREADY_VOTED';
    return res.status(409).json({ success: false, code, message: code === 'ALREADY_VOTED' ? 'Already voted' : 'Card is not registered' });
  }

  // Step 2: store the ballot. It carries no UID, so it cannot be traced back to the voter.
  let receipt = null;
  try {
    for (let i = 0; i < 5 && !receipt; i++) {
      const candidate = receiptCode();
      try {
        await c.votes.insertOne({ option, boothId: booth, castAt: bucket5(new Date()), receipt: candidate, reqId });
        receipt = candidate;
      } catch (e) {
        if (!(e.code === 11000 && e.keyPattern && e.keyPattern.receipt)) throw e;
      }
    }
    if (!receipt) throw new Error('Could not allocate a receipt code');
  } catch (e) {
    await c.voters.updateOne({ uid }, { $set: { hasVoted: false }, $unset: { votedAt: '' } });
    throw e;
  }

  const turnout = await c.voters.countDocuments({ hasVoted: true });
  await audit.append('booth:' + booth, 'vote cast', 'turnout is now ' + turnout);
  events.emit('vote', { booth });
  events.emit('activity', { kind: 'good', text: `${booth} recorded a vote. Turnout is now ${turnout}.` });
  res.json({ success: true, code: 'OK', receipt });
}));

module.exports = router;
