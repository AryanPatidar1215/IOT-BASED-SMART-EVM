const readline = require('readline');
const bcrypt = require('bcryptjs');
const { connect, c, client } = require('../db');
const audit = require('../services/audit');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { rl.output.write(s.includes(question) ? s : '*'); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) console.log(''); resolve(answer); });
  });
}

(async () => {
  await connect();
  const username = String(process.env.ADMIN_USERNAME || (await ask('Admin username: '))).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) { console.error('Username needs 3 to 30 letters, numbers, dots, dashes or underscores.'); process.exit(1); }
  const password = String(process.env.ADMIN_PASSWORD || (await ask('Admin password (10+ characters): ', true)));
  if (password.length < 10) { console.error('Password needs at least 10 characters.'); process.exit(1); }

  const existing = await c.admins.findOne({ username });
  const passwordHash = await bcrypt.hash(password, 12);
  if (existing) {
    await c.admins.updateOne({ username }, { $set: { passwordHash, passwordChangedAt: new Date() } });
    await audit.append('system', 'admin password reset', `admin "${username}" reset from the command line`);
    console.log(`Updated the password for "${username}".`);
  } else {
    await c.admins.insertOne({ username, passwordHash, createdAt: new Date() });
    await audit.append('system', 'admin created', `admin "${username}" created from the command line`);
    console.log(`Created admin "${username}".`);
  }
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
