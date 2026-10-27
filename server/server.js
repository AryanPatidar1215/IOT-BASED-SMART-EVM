const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const config = require('./config');
const { connect, c, client } = require('./db');
const audit = require('./services/audit');

const app = express();
app.set('trust proxy', false);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': null
    }
  },
  strictTransportSecurity: false
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/device', require('./routes/device'));
app.use('/api/public', require('./routes/public'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, success: false });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.', success: false, code: 'SERVER' });
});

async function bootstrapAdmin() {
  if (await c.admins.countDocuments({})) return;
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  if (username && password.length >= 10) {
    await c.admins.insertOne({ username, passwordHash: await bcrypt.hash(password, 12), createdAt: new Date() });
    await audit.append('system', 'admin created', 'first admin "' + username + '" from environment');
    console.log(`[setup] Created admin "${username}" from .env. Remove ADMIN_PASSWORD from .env now.`);
  } else {
    console.log('[setup] No admin exists yet. Run: npm run create-admin');
  }
}

async function start() {
  await connect();
  await bootstrapAdmin();
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`Smart EVM running on port ${config.port}`);
    console.log(`  Public page:  http://localhost:${config.port}/`);
    console.log(`  Admin panel:  http://localhost:${config.port}/admin`);
  });
  const stop = async () => { server.close(); await client.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

start().catch((e) => {
  console.error('Failed to start:', e.message);
  process.exit(1);
});
