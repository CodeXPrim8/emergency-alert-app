const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { signToken } = require('../utils/jwt');
const { generateOtp, otpExpiresIn } = require('../utils/otp');
const { getPublicKey } = require('../utils/encryption');
const { authenticate } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimit');
const { normalizePhone, normalizeEmail } = require('../utils/phone');
const { findUserByPhone, findUserByEmail } = require('../utils/userLookup');

const router = express.Router();

function formatUser(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    phoneVerified: Boolean(row.phone_verified),
    emailVerified: Boolean(row.email_verified),
  };
}

router.post('/register', async (req, res) => {
  try {
    const { name, phone, email, password, confirmPassword, publicKey } = req.body;

    if (!name || !password || (!phone && !email)) {
      return res.status(400).json({ error: 'Name, password, and phone or email are required' });
    }

    if (confirmPassword !== undefined && password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const normalizedPhone = normalizePhone(phone);
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedPhone && !normalizedEmail) {
      return res.status(400).json({ error: 'Enter a valid phone number or email' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = generateOtp();

    const result = await pool.query(
      `INSERT INTO users (name, phone, email, password_hash, public_key, otp_code, otp_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, phone, email, phone_verified, email_verified, created_at`,
      [name.trim(), normalizedPhone, normalizedEmail, passwordHash, publicKey || null, otp, otpExpiresIn()]
    );

    const user = result.rows[0];

    // In production: send OTP via SMS/email provider
    if (process.env.NODE_ENV !== 'production') {
      console.log(`OTP for ${phone || email}: ${otp}`);
    }

    const token = signToken({ userId: user.id, name: user.name });

    res.status(201).json({
      message: 'Registration successful. Verify your phone/email with the OTP sent.',
      user: formatUser(user),
      token,
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Phone or email already registered' });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    if (!password || (!phone && !email)) {
      return res.status(400).json({ error: 'Password and phone or email are required' });
    }

    const rawEmail = String(email || '').trim();
    const rawPhone = String(phone || '').trim();

    let user = null;
    if (rawEmail) user = await findUserByEmail(rawEmail);
    if (!user && rawPhone) user = await findUserByPhone(rawPhone);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken({ userId: user.id, name: user.name });

    res.json({
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/verify-otp', loginLimiter, async (req, res) => {
  try {
    const { phone, email, otp } = req.body;

    const result = await pool.query(
      'SELECT * FROM users WHERE (phone = $1 OR email = $2) AND otp_code = $3 AND otp_expires_at > NOW()',
      [phone || null, email || null, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    const user = result.rows[0];
    const updates = phone
      ? 'phone_verified = TRUE, otp_code = NULL, otp_expires_at = NULL'
      : 'email_verified = TRUE, otp_code = NULL, otp_expires_at = NULL';

    await pool.query(`UPDATE users SET ${updates}, updated_at = NOW() WHERE id = $1`, [user.id]);

    res.json({ message: 'Verification successful' });
  } catch (err) {
    console.error('OTP verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

router.post('/device', authenticate, async (req, res) => {
  try {
    const { deviceToken, deviceId } = req.body;

    await pool.query(
      'UPDATE users SET device_token = $1, device_id = $2, updated_at = NOW() WHERE id = $3',
      [deviceToken || null, deviceId || null, req.user.userId]
    );

    res.json({ message: 'Device registered' });
  } catch (err) {
    console.error('Device register error:', err);
    res.status(500).json({ error: 'Device registration failed' });
  }
});

router.get('/public-key', (req, res) => {
  const publicKey = getPublicKey();
  if (!publicKey) {
    return res.status(503).json({ error: 'Encryption keys not configured' });
  }
  res.json({ publicKey });
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, phone, email, phone_verified, email_verified, device_id, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
