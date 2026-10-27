const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const config = require('../config');
const { c } = require('../db');
const { httpError } = require('../util');

function adminAuth(req, res, next) {
  const token = req.cookies.evm_admin;
  if (!token) return res.status(401).json({ error: 'Log in to continue.' });
  try {
    const p = jwt.verify(token, config.jwtSecret);
    req.admin = { id: p.sub, username: p.username };
    next();
  } catch {
    res.status(401).json({ error: 'Your session expired. Log in again.' });
  }
}

// Step-up check: sensitive actions need the admin's password again, even inside a valid session.
async function confirmPassword(req) {
  const pw = String((req.body && req.body.password) || '');
  let admin = null;
  try { admin = await c.admins.findOne({ _id: new ObjectId(req.admin.id) }); } catch { /* invalid id */ }
  if (!admin || !pw || !(await bcrypt.compare(pw, admin.passwordHash))) {
    throw httpError(403, 'Wrong admin password.');
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function deviceAuth(req, res, next) {
  try {
    const id = String(req.get('x-device-id') || '');
    const key = String(req.get('x-device-key') || '');
    const device = id && key ? await c.devices.findOne({ deviceId: id, active: true }) : null;
    let ok = false;
    if (device) {
      const a = Buffer.from(sha256(key), 'hex');
      const b = Buffer.from(device.keyHash, 'hex');
      ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    }
    if (!ok) return res.status(401).json({ success: false, eligible: false, code: 'BAD_DEVICE', message: 'Device not authorized' });
    await c.devices.updateOne({ deviceId: id }, { $set: { lastSeen: new Date(), ip: req.ip } });
    req.device = device;
    next();
  } catch (e) { next(e); }
}

module.exports = { adminAuth, confirmPassword, deviceAuth, sha256 };
