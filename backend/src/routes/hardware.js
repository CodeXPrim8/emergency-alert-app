const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { HARDWARE_PRODUCTS } = require('../data/hardware-products');

const router = express.Router();
const productMap = new Map(HARDWARE_PRODUCTS.map((p) => [p.id, p]));

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.get('/products', (req, res) => {
  res.json({ products: HARDWARE_PRODUCTS });
});

router.get('/requests', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, product_id, product_name, quantity, unit_price, currency,
              notes, shipping_address, contact_email, contact_phone, batch_id,
              status, created_at
       FROM hardware_requests
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.user.userId]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('Fetch hardware requests failed:', err);
    res.status(500).json({ error: 'Failed to fetch hardware requests' });
  }
});

router.post('/requests', authenticate, async (req, res) => {
  try {
    const { items, email, phone, shippingAddress, notes } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Select at least one product' });
    }

    const cleanEmail = typeof email === 'string' ? email.trim() : '';
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    const cleanAddress = typeof shippingAddress === 'string' ? shippingAddress.trim() : '';
    const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 500) : null;

    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (!cleanPhone || cleanPhone.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ error: 'A valid phone number is required' });
    }
    if (!cleanAddress || cleanAddress.length < 10) {
      return res.status(400).json({ error: 'A full delivery address is required' });
    }

    const batchId = randomUUID();
    const created = [];

    for (const item of items) {
      const product = productMap.get(item.productId);
      if (!product) {
        return res.status(400).json({ error: `Invalid product: ${item.productId}` });
      }

      const qty = Math.min(Math.max(parseInt(item.quantity, 10) || 1, 1), 10);

      const result = await pool.query(
        `INSERT INTO hardware_requests
           (user_id, product_id, product_name, quantity, unit_price, currency,
            notes, shipping_address, contact_email, contact_phone, batch_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
         RETURNING *`,
        [
          req.user.userId,
          product.id,
          product.name,
          qty,
          product.price,
          product.currency,
          cleanNotes || null,
          cleanAddress,
          cleanEmail,
          cleanPhone,
          batchId,
        ]
      );

      created.push(result.rows[0]);
    }

    res.status(201).json({
      requests: created,
      batchId,
      message: `Hardware request submitted for ${created.length} item(s). Our team will contact you to complete your order.`,
    });
  } catch (err) {
    console.error('Create hardware request failed:', err);
    res.status(500).json({ error: 'Failed to submit hardware request' });
  }
});

module.exports = router;
