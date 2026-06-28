const express = require('express');
const pool = require('../db/pool');
const config = require('../config');
const { authenticate, authenticateUserOrLiveBroadcast } = require('../middleware/auth');
const { emergencyLimiter } = require('../middleware/rateLimit');
const { decryptHybridPayload } = require('../utils/encryption');
const { findNearbyUsers, updateUserLocation } = require('../services/nearby');
const { notifyNearbyUsers, notifyEmergencyContacts } = require('../services/notifications');
const { signLiveToken } = require('../utils/jwt');

const router = express.Router();

router.post('/emergency', authenticate, emergencyLimiter, async (req, res) => {
  try {
    let alertData;

    if (req.body.encryptedPayload) {
      const { payload, nonce } = decryptHybridPayload(req.body.encryptedPayload);
      alertData = payload;

      // Replay attack protection
      const nonceCheck = await pool.query(
        'INSERT INTO alert_nonces (nonce, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING nonce',
        [nonce, req.user.userId]
      );
      if (nonceCheck.rows.length === 0) {
        return res.status(409).json({ error: 'Duplicate request detected' });
      }
    } else if (process.env.NODE_ENV !== 'production') {
      // Allow unencrypted in dev for testing
      alertData = req.body;
    } else {
      return res.status(400).json({ error: 'Encrypted payload required' });
    }

    const { latitude, longitude, alertType = 'sos', deviceId, timestamp } = alertData;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const result = await pool.query(
      `INSERT INTO alerts (user_id, latitude, longitude, alert_type, device_id, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       RETURNING *`,
      [req.user.userId, latitude, longitude, alertType, deviceId || null]
    );

    const alert = result.rows[0];

    await updateUserLocation(req.user.userId, latitude, longitude);

    const nearbyUsers = await findNearbyUsers(
      longitude,
      latitude,
      config.nearbyRadiusMeters,
      req.user.userId
    );

    // Get alerting user info
    const userResult = await pool.query('SELECT name FROM users WHERE id = $1', [req.user.userId]);
    const userName = userResult.rows[0]?.name || 'A user';

    // Send notifications
    const nearbyNotifications = await notifyNearbyUsers(nearbyUsers, alert, { name: userName });
    const contactNotifications = await notifyEmergencyContacts(req.user.userId, alert, userName);

    res.status(201).json({
      alert: {
        id: alert.id,
        status: alert.status,
        alertType: alert.alert_type,
        latitude: alert.latitude,
        longitude: alert.longitude,
        createdAt: alert.created_at,
        cancelGraceSeconds: config.alertCancelGraceSeconds,
      },
      liveToken: signLiveToken(alert.id, req.user.userId),
      nearbyUsersFound: nearbyUsers.length,
      nearbyUsersNotified: nearbyNotifications.filter((n) => n.sent).length,
      contactsNotified: contactNotifications.length,
    });
  } catch (err) {
    console.error('Emergency alert error:', err);
    if (err.message.includes('signature') || err.message.includes('timestamp') || err.message.includes('decrypt')) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Failed to create emergency alert' });
  }
});

router.post('/emergency/:id/cancel', authenticate, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM alerts WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Active alert not found' });
    }

    const alert = result.rows[0];
    const elapsed = (Date.now() - new Date(alert.created_at).getTime()) / 1000;

    if (elapsed > config.alertCancelGraceSeconds) {
      return res.status(400).json({
        error: `Cancellation grace period of ${config.alertCancelGraceSeconds}s has expired`,
      });
    }

    await pool.query(
      `UPDATE alerts SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Alert cancelled successfully', alertId: id });
  } catch (err) {
    console.error('Cancel alert error:', err);
    res.status(500).json({ error: 'Failed to cancel alert' });
  }
});

router.get('/emergency/contacts-in-distress', authenticate, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT last_latitude, last_longitude FROM users WHERE id = $1',
      [req.user.userId]
    );
    const viewer = userResult.rows[0];
    if (!viewer?.last_latitude || !viewer?.last_longitude) {
      return res.json({ alert: null });
    }

    const lat = viewer.last_latitude;
    const lng = viewer.last_longitude;

    const result = await pool.query(
      `SELECT a.id, a.latitude, a.longitude,
              COALESCE(a.live_latitude, a.latitude) AS live_latitude,
              COALESCE(a.live_longitude, a.longitude) AS live_longitude,
              a.alert_type, a.status, a.created_at, u.name AS user_name, u.id AS user_id,
              (6371000 * acos(
                MIN(1.0, MAX(-1.0,
                  cos(radians($2)) * cos(radians(COALESCE(a.live_latitude, a.latitude))) *
                  cos(radians(COALESCE(a.live_longitude, a.longitude)) - radians($3)) +
                  sin(radians($4)) * sin(radians(COALESCE(a.live_latitude, a.latitude)))
                ))
              )) AS distance_meters
       FROM alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'active'
         AND a.user_id != $1
         AND EXISTS (
           SELECT 1 FROM emergency_contacts ec
           WHERE ec.user_id = $5
             AND (
               (ec.phone IS NOT NULL AND ec.phone != '' AND u.phone IS NOT NULL AND ec.phone = u.phone)
               OR (ec.email IS NOT NULL AND ec.email != '' AND u.email IS NOT NULL AND ec.email = u.email)
             )
         )
       ORDER BY distance_meters ASC
       LIMIT 1`,
      [req.user.userId, lat, lng, lat, req.user.userId]
    );

    res.json({ alert: result.rows[0] || null });
  } catch (err) {
    console.error('Contacts in distress error:', err);
    res.status(500).json({ error: 'Failed to fetch contact distress alerts' });
  }
});

router.get('/emergency/nearby', authenticate, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT last_latitude, last_longitude FROM users WHERE id = $1',
      [req.user.userId]
    );

    const user = userResult.rows[0];
    if (!user?.last_latitude || !user?.last_longitude) {
      return res.json({ alerts: [] });
    }

    const radius = config.nearbyRadiusMeters;
    const result = await pool.query(
      `SELECT a.id, a.latitude, a.longitude, a.live_latitude, a.live_longitude,
              a.alert_type, a.status, a.created_at, u.name as user_name
       FROM alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.status = 'active'
         AND a.user_id != $1
         AND a.created_at > datetime('now', '-1 hour')
         AND (6371000 * acos(
           MIN(1.0, MAX(-1.0,
             cos(radians($2)) * cos(radians(a.latitude)) *
             cos(radians(a.longitude) - radians($3)) +
             sin(radians($4)) * sin(radians(a.latitude))
           ))
         )) <= $5
       ORDER BY a.created_at DESC`,
      [req.user.userId, user.last_latitude, user.last_longitude, user.last_latitude, radius]
    );

    res.json({ alerts: result.rows });
  } catch (err) {
    console.error('Nearby alerts error:', err);
    res.status(500).json({ error: 'Failed to fetch nearby alerts' });
  }
});

router.get('/emergency/active', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, latitude, longitude, alert_type, status, created_at
       FROM alerts WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.json({ alert: null });
    }

    const alert = result.rows[0];
    res.json({
      alert: {
        id: alert.id,
        status: alert.status,
        alertType: alert.alert_type,
        latitude: alert.latitude,
        longitude: alert.longitude,
        createdAt: alert.created_at,
        cancelGraceSeconds: config.alertCancelGraceSeconds,
      },
      liveToken: signLiveToken(alert.id, req.user.userId),
    });
  } catch (err) {
    console.error('Get active alert error:', err);
    res.status(500).json({ error: 'Failed to fetch active alert' });
  }
});

router.get('/emergency', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, latitude, longitude, alert_type, status, created_at, cancelled_at
       FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.userId]
    );
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.get('/emergency/:id/live', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id, a.latitude, a.longitude, a.live_latitude, a.live_longitude,
              a.live_updated_at, a.alert_type, a.status, a.created_at, u.name AS user_name
       FROM alerts a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const alert = result.rows[0];
    res.json({
      alert: {
        id: alert.id,
        status: alert.status,
        alertType: alert.alert_type,
        latitude: alert.latitude,
        longitude: alert.longitude,
        liveLatitude: alert.live_latitude ?? alert.latitude,
        liveLongitude: alert.live_longitude ?? alert.longitude,
        liveUpdatedAt: alert.live_updated_at || alert.created_at,
        userName: alert.user_name,
        createdAt: alert.created_at,
      },
    });
  } catch (err) {
    console.error('Get live alert error:', err);
    res.status(500).json({ error: 'Failed to fetch live location' });
  }
});

router.post('/emergency/:id/live', authenticateUserOrLiveBroadcast, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    if (latitude == null || longitude == null) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const check = await pool.query(
      `SELECT id FROM alerts WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [req.params.id, req.user.userId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ error: 'Active alert not found' });
    }

    await pool.query(
      `UPDATE alerts SET live_latitude = $1, live_longitude = $2, live_updated_at = NOW() WHERE id = $3`,
      [latitude, longitude, req.params.id]
    );
    await updateUserLocation(req.user.userId, latitude, longitude);

    res.json({
      message: 'Live location updated',
      liveLatitude: latitude,
      liveLongitude: longitude,
      liveUpdatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Update live location error:', err);
    res.status(500).json({ error: 'Failed to update live location' });
  }
});

router.get('/emergency/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM alerts WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.json({ alert: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alert' });
  }
});

module.exports = router;
