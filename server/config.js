const crypto = require('crypto');
require('dotenv').config();

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 24) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] JWT_SECRET is missing or short. Using a random one, so admin sessions reset on every restart.');
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017',
  dbName: process.env.DB_NAME || 'smartEVM',
  jwtSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: 8,
  deviceOnlineMs: 30000
};
