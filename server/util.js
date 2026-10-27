const crypto = require('crypto');

const asyncH = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function normUid(value) {
  const uid = String(value || '').replace(/[\s:-]/g, '').toUpperCase();
  return /^[0-9A-F]{8,20}$/.test(uid) ? uid : null;
}

const maskUid = (uid) => '****' + String(uid).slice(-4);

// Votes and voter records only keep a 5-minute bucket, so timestamps
// cannot be used to match a voter to a ballot.
function bucket5(date) {
  const ms = 5 * 60 * 1000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function receiptCode() {
  let s = '';
  for (let i = 0; i < 6; i++) {
    s += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (i === 2) s += '-';
  }
  return s;
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

module.exports = { asyncH, normUid, maskUid, bucket5, receiptCode, escapeRegex, httpError };
