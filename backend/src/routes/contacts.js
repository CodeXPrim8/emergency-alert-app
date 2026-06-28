const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, phone, email, created_at FROM emergency_contacts WHERE user_id = $1 ORDER BY created_at',
      [req.user.userId]
    );
    res.json({ contacts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || (!phone && !email)) {
      return res.status(400).json({ error: 'Name and phone or email are required' });
    }

    const result = await pool.query(
      `INSERT INTO emergency_contacts (user_id, name, phone, email)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.userId, name, phone || null, email || null]
    );

    res.status(201).json({ contact: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add contact' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Contact not found' });
    }
    res.json({ message: 'Contact deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

module.exports = router;
