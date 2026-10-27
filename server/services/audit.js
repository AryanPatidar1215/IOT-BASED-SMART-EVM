const crypto = require('crypto');
const { c } = require('../db');

const ZERO = '0'.repeat(64);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashOf = (e) => sha([e.seq, e.ts, e.actor, e.action, e.details, e.prevHash].join('|'));

let chain = Promise.resolve();

async function doAppend(actor, action, details) {
  const last = await c.audit.find().sort({ seq: -1 }).limit(1).next();
  const entry = {
    seq: last ? last.seq + 1 : 1,
    ts: new Date().toISOString(),
    actor: String(actor),
    action: String(action),
    details: String(details || ''),
    prevHash: last ? last.hash : ZERO
  };
  entry.hash = hashOf(entry);
  await c.audit.insertOne(entry);
  return entry;
}

// Appends are serialized so two events can never claim the same position in the chain.
function append(actor, action, details) {
  const run = chain.then(() => doAppend(actor, action, details));
  chain = run.catch(() => {});
  return run;
}

async function verify() {
  let prev = ZERO;
  let expected = 1;
  let count = 0;
  const cursor = c.audit.find().sort({ seq: 1 });
  for await (const e of cursor) {
    if (e.seq !== expected) return { ok: false, count, brokenAt: expected, reason: 'An entry is missing from the chain.' };
    if (e.prevHash !== prev) return { ok: false, count, brokenAt: e.seq, reason: 'The link to the previous entry does not match.' };
    if (hashOf(e) !== e.hash) return { ok: false, count, brokenAt: e.seq, reason: 'The entry contents were changed after it was written.' };
    prev = e.hash;
    expected++;
    count++;
  }
  return { ok: true, count };
}

async function list(limit = 100) {
  return c.audit.find({}, { projection: { _id: 0 } }).sort({ seq: -1 }).limit(limit).toArray();
}

module.exports = { append, verify, list };
