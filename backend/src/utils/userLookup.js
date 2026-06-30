const pool = require('../db/pool');
const { normalizePhone, normalizeEmail, phoneLookupVariants } = require('../utils/phone');

async function findUserByPhone(rawPhone) {
  const variants = phoneLookupVariants(rawPhone);
  for (const candidate of variants) {
    const result = await pool.query('SELECT * FROM users WHERE phone = $1', [candidate]);
    if (result.rows.length > 0) return result.rows[0];
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
