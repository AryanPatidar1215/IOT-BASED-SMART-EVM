const { MongoClient } = require('mongodb');
const config = require('./config');

const client = new MongoClient(config.mongoUri);
const c = {};

const DEFAULT_CANDIDATES = [
  { no: 1, name: 'Candidate 1', symbol: 'A', color: '#e4e2da' },
  { no: 2, name: 'Candidate 2', symbol: 'B', color: '#d64545' },
  { no: 3, name: 'Candidate 3', symbol: 'C', color: '#e6b422' },
  { no: 4, name: 'Candidate 4', symbol: 'D', color: '#3f9d5a' }
];

async function connect() {
  await client.connect();
  const db = client.db(config.dbName);

  c.admins = db.collection('admins');
  c.voters = db.collection('voters');
  c.votes = db.collection('votes');
  c.devices = db.collection('devices');
  c.audit = db.collection('auditLog');
  c.election = db.collection('election');

  await c.admins.createIndex({ username: 1 }, { unique: true });
  await c.voters.createIndex({ uid: 1 }, { unique: true });
  await c.voters.createIndex({ voterId: 1 }, { unique: true });
  await c.votes.createIndex({ reqId: 1 }, { unique: true });
  await c.votes.createIndex({ receipt: 1 }, { unique: true });
  await c.devices.createIndex({ deviceId: 1 }, { unique: true });
  await c.audit.createIndex({ seq: 1 }, { unique: true });

  await c.election.updateOne(
    { _id: 'current' },
    {
      $setOnInsert: {
        title: 'General election',
        status: 'draft',
        candidates: DEFAULT_CANDIDATES,
        createdAt: new Date()
      }
    },
    { upsert: true }
  );
  return c;
}

module.exports = { c, connect, client };
