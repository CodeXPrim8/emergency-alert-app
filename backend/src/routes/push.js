const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { getVapidPublicKey } = require('../services/webPush');

const router = express.Router();

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

router.post('/subscribe', authenticate, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Valid push subscription required' });
    }

    const endpoint = subscription.endpoint;

    const existing = await pool.query(
      'SELECT id FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.userId, endpoint]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE push_subscriptions SET subscription_json = $1, updated_at = NOW() WHERE user_id = $2 AND endpoint = $3',
        [JSON.stringify(subscription), req.user.userId, endpoint]
      );
    } else {
      await pool.query(
        'INSERT INTO push_subscriptions (user_id, endpoint, subscription_json) VALUES ($1, $2, $3)',
        [req.user.userId, endpoint, JSON.stringify(subscription)]
      );
    }

    res.json({ message: 'Push subscription saved' });
  } catch (err) {
    console.error('Push subscribe error:', err);
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

router.delete('/subscribe', authenticate, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ error: 'Endpoint required' });
    }
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.user.userId, endpoint]
    );
    res.json({ message: 'Unsubscribed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

module.exports = router;
