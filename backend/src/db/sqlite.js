const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const config = require('../config');

const dataDir = path.dirname(config.sqlitePath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(config.sqlitePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  public_key TEXT,
  device_token TEXT,
  device_id TEXT,
  phone_verified INTEGER DEFAULT 0,
  email_verified INTEGER DEFAULT 0,
  otp_code TEXT,
  otp_expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  alert_type TEXT NOT NULL DEFAULT 'sos',
  status TEXT NOT NULL DEFAULT 'active',
  device_id TEXT,
  cancelled_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_nonces (
  nonce TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user_id ON emergency_contacts(user_id);
`;

function initSchema() {
  db.exec(SCHEMA);
  migrate();
  console.log('SQLite database ready:', config.sqlitePath);
}

function migrate() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('last_latitude')) {
    db.exec('ALTER TABLE users ADD COLUMN last_latitude REAL');
    db.exec('ALTER TABLE users ADD COLUMN last_longitude REAL');
    db.exec('ALTER TABLE users ADD COLUMN location_updated_at TEXT');
  }

  const alertCols = db.prepare('PRAGMA table_info(alerts)').all().map((c) => c.name);
  if (!alertCols.includes('live_latitude')) {
    db.exec('ALTER TABLE alerts ADD COLUMN live_latitude REAL');
    db.exec('ALTER TABLE alerts ADD COLUMN live_longitude REAL');
    db.exec('ALTER TABLE alerts ADD COLUMN live_updated_at TEXT');
    db.exec('UPDATE alerts SET live_latitude = latitude, live_longitude = longitude, live_updated_at = created_at WHERE live_latitude IS NULL');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      subscription_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS hardware_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      notes TEXT,
      shipping_address TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      batch_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_hardware_requests_user_id ON hardware_requests(user_id);
  `);

  const hwCols = db.prepare('PRAGMA table_info(hardware_requests)').all().map((c) => c.name);
  if (hwCols.length && !hwCols.includes('contact_email')) {
    db.exec('ALTER TABLE hardware_requests ADD COLUMN contact_email TEXT');
    db.exec('ALTER TABLE hardware_requests ADD COLUMN contact_phone TEXT');
    db.exec('ALTER TABLE hardware_requests ADD COLUMN batch_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_hardware_requests_batch_id ON hardware_requests(batch_id)');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS sos_media_chunks (
      id TEXT PRIMARY KEY,
      alert_id TEXT NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      media_type TEXT NOT NULL DEFAULT 'audiovideo',
      file_path TEXT NOT NULL,
      file_size INTEGER,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sos_media_alert_id ON sos_media_chunks(alert_id);
  `);
}

function preprocessSql(text) {
  return text
    .replace(/NOW\(\)/gi, "datetime('now')")
    .replace(/TRUE/gi, '1')
    .replace(/FALSE/gi, '0')
    .replace(/\$(\d+)/g, '?');
}

function stripReturning(text) {
  return text.replace(/\s+RETURNING\s+.+$/i, '');
}

function boolifyRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const key of ['phone_verified', 'email_verified']) {
    if (key in out) out[key] = Boolean(out[key]);
  }
  return out;
}

function normalizeParams(params) {
  return params.map((p) => (p instanceof Date ? p.toISOString() : p));
}

async function query(text, params = []) {
  const values = normalizeParams(params);
  let sql = preprocessSql(text);
  sql = stripReturning(sql);
  const upper = sql.trim().toUpperCase();

  try {
    if (upper.startsWith('SELECT')) {
      const rows = db.prepare(sql).all(...values).map(boolifyRow);
      return { rows, rowCount: rows.length };
    }

    if (upper.startsWith('UPDATE')) {
      const info = db.prepare(sql).run(...values);
      return { rows: [], rowCount: info.changes };
    }

    if (upper.startsWith('DELETE')) {
      if (/DELETE FROM push_subscriptions/i.test(sql)) {
        const info = db.prepare(sql).run(...values);
        return { rows: [], rowCount: info.changes };
      }
      const info = db.prepare(sql).run(...values);
      return { rows: [], rowCount: info.changes };
    }

    if (upper.startsWith('INSERT')) {
      if (/INSERT INTO users/i.test(sql)) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO users (id, name, phone, email, password_hash, public_key, otp_code, otp_expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, ...values);
        const row = db.prepare(
          'SELECT id, name, phone, email, phone_verified, email_verified, created_at FROM users WHERE id = ?'
        ).get(id);
        return { rows: [boolifyRow(row)], rowCount: 1 };
      }

      if (/INSERT INTO emergency_contacts/i.test(sql)) {
        const id = randomUUID();
        db.prepare(
          'INSERT INTO emergency_contacts (id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)'
        ).run(id, ...values);
        const row = db.prepare('SELECT * FROM emergency_contacts WHERE id = ?').get(id);
        return { rows: [row], rowCount: 1 };
      }

      if (/INSERT INTO alerts/i.test(sql)) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO alerts (id, user_id, latitude, longitude, alert_type, device_id, status, live_latitude, live_longitude, live_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, datetime('now'))`
        ).run(id, values[0], values[1], values[2], values[3], values[4], values[1], values[2]);
        const row = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
        return { rows: [row], rowCount: 1 };
      }

      if (/INSERT INTO alert_nonces/i.test(sql)) {
        try {
          db.prepare('INSERT INTO alert_nonces (nonce, user_id) VALUES (?, ?)').run(...values);
          return { rows: [{ nonce: values[0] }], rowCount: 1 };
        } catch (err) {
          if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return { rows: [], rowCount: 0 };
          }
          throw err;
        }
      }

      if (/INSERT INTO push_subscriptions/i.test(sql)) {
        const id = randomUUID();
        db.prepare(
          'INSERT INTO push_subscriptions (id, user_id, endpoint, subscription_json) VALUES (?, ?, ?, ?)'
        ).run(id, ...values);
        return { rows: [{ id }], rowCount: 1 };
      }

      if (/INSERT INTO sos_media_chunks/i.test(sql)) {
        db.prepare(
          `INSERT INTO sos_media_chunks
             (id, alert_id, user_id, sequence, media_type, file_path, file_size, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(...values);
        const row = db.prepare('SELECT * FROM sos_media_chunks WHERE id = ?').get(values[0]);
        return { rows: [row], rowCount: 1 };
      }

      if (/INSERT INTO hardware_requests/i.test(sql)) {
        const id = randomUUID();
        db.prepare(
          `INSERT INTO hardware_requests
             (id, user_id, product_id, product_name, quantity, unit_price, currency, notes, shipping_address, contact_email, contact_phone, batch_id, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
        ).run(id, ...values);
        const row = db.prepare('SELECT * FROM hardware_requests WHERE id = ?').get(id);
        return { rows: [row], rowCount: 1 };
      }

      const info = db.prepare(sql).run(...values);
      return { rows: [], rowCount: info.changes };
    }

    db.exec(sql);
    return { rows: [], rowCount: 0 };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const pgErr = new Error(err.message);
      pgErr.code = '23505';
      throw pgErr;
    }
    throw err;
  }
}

async function connect() {
  return { query, release: () => {} };
}

initSchema();

module.exports = { query, connect, db, initSchema };
