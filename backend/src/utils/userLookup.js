const pool = require('../db/pool');
const {
  normalizePhone,
  normalizeEmail,
  phoneLookupVariants,
  buildPhoneDigitKeys,
} = require('../utils/phone');

async function findUserByPhone(rawPhone) {
  const searchKeys = new Set(buildPhoneDigitKeys(rawPhone));
  const normalized = normalizePhone(rawPhone);
  if (normalized) searchKeys.add(normalized.replace(/\D/g, ''));

  for (const candidate of phoneLookupVariants(rawPhone)) {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [candidate]);
    if (result.rows.length > 0) return result.rows[0];
  }

  if (normalized) {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [normalized]);
    if (result.rows.length > 0) return result.rows[0];
  }

  const all = await pool.query('SELECT * FROM users WHERE phone IS NOT NULL');
  for (const user of all.rows) {
    const userKeys = buildPhoneDigitKeys(user.phone);
    if (userKeys.some((k) => searchKeys.has(k))) return user;
  }

  return null;
}

async function findUserByEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return null;

  const result = await pool.query(
    'SELECT * FROM users WHERE lower(trim(email)) = $1',
    [email]
  );
  if (result.rows.length > 0) return result.rows[0];

  const exact = await pool.query('SELECT * FROM users WHERE email = $1', [String(rawEmail || '').trim()]);
  return exact.rows[0] || null;
}

module.exports = { findUserByPhone, findUserByEmail };
