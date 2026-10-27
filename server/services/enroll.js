// Enrollment mode: an admin arms it (with their password), and the next card
// scanned on any booth is registered as that voter. Nothing else can create voters.
let state = null;
let lastResult = null;

function start({ name, voterId, by, ttlMs = 60000 }) {
  state = { name, voterId, by, expiresAt: Date.now() + ttlMs };
  lastResult = null;
  return state;
}

function active() {
  if (state && state.expiresAt < Date.now()) state = null;
  return state;
}

const clear = () => { state = null; };
const setResult = (r) => { lastResult = { ...r, at: Date.now() }; };
const getResult = () => lastResult;

module.exports = { start, active, clear, setResult, getResult };
