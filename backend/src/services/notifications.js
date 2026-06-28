let firebaseApp = null;

function initFirebase(serviceAccountPath) {
  if (!serviceAccountPath) return;

  try {
    const admin = require('firebase-admin');
    const serviceAccount = require(require('path').resolve(serviceAccountPath));
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log('Firebase Admin initialized');
  } catch (err) {
    console.warn('Firebase init failed:', err.message);
  }
}

async function sendFcmNotification(deviceToken, notification, data = {}) {
  if (!firebaseApp || !deviceToken) return false;

  try {
    const admin = require('firebase-admin');
    await admin.messaging().send({
      token: deviceToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
      android: { priority: 'high' },
      apns: {
        payload: { aps: { sound: 'default', 'content-available': 1 } },
      },
    });
    return true;
  } catch (err) {
    console.error('FCM send failed:', err.message);
    return false;
  }
}

async function sendWebPushToUser(userId, payload) {
  const pool = require('../db/pool');
  const { sendWebPush } = require('./webPush');

  const result = await pool.query(
    'SELECT id, subscription_json FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );

  const notifications = [];
  for (const row of result.rows) {
    const subscription = JSON.parse(row.subscription_json);
    const sent = await sendWebPush(subscription, payload);

    if (sent && sent.expired) {
      await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
      notifications.push({ userId, sent: false, expired: true });
    } else {
      notifications.push({ userId, sent: Boolean(sent) });
    }
  }

  return notifications;
}

async function notifyNearbyUsers(nearbyUsers, alert, alertUser) {
  const pool = require('../db/pool');
  const notifications = [];

  for (const { userId, distanceMeters } of nearbyUsers) {
    const distanceKm = (distanceMeters / 1000).toFixed(1);
    const title = 'Emergency Alert Nearby';
    const body = `${alert.alert_type.toUpperCase()} alert ~${distanceKm} km away`;

    const payload = {
      title,
      body,
      alertId: alert.id,
      alertType: alert.alert_type,
      distanceMeters,
      timestamp: alert.created_at,
      latitude: alert.live_latitude ?? alert.latitude,
      longitude: alert.live_longitude ?? alert.longitude,
      mapUrl: `/?alertId=${alert.id}`,
      fromUser: alertUser.name,
    };

    const webResults = await sendWebPushToUser(userId, payload);
    const webSent = webResults.some((n) => n.sent);

    const userResult = await pool.query(
      'SELECT device_token FROM users WHERE id = $1 AND device_token IS NOT NULL',
      [userId]
    );

    let fcmSent = false;
    if (userResult.rows.length > 0) {
      fcmSent = await sendFcmNotification(
        userResult.rows[0].device_token,
        { title, body },
        payload
      );
    }

    notifications.push({ userId, sent: webSent || fcmSent, distanceMeters });
  }

  return notifications;
}

async function notifyEmergencyContacts(userId, alert, userName) {
  const pool = require('../db/pool');
  const contacts = await pool.query(
    'SELECT * FROM emergency_contacts WHERE user_id = $1',
    [userId]
  );

  const notifications = [];
  const mapUrl = `/?alertId=${alert.id}`;

  for (const contact of contacts.rows) {
    let usersNotified = 0;

    if (contact.phone || contact.email) {
      const matchedUsers = await pool.query(
        `SELECT id, name FROM users
         WHERE id != $1
           AND (
             ($2 IS NOT NULL AND $2 != '' AND phone = $2)
             OR ($3 IS NOT NULL AND $3 != '' AND email = $3)
           )`,
        [userId, contact.phone || null, contact.email || null]
      );

      for (const matched of matchedUsers.rows) {
        const payload = {
          title: `SOS from ${userName}`,
          body: `${userName} triggered SOS. Live location, video, and audio are shared with emergency contacts only.`,
          alertId: alert.id,
          mapUrl,
          fromUser: userName,
          contactOnly: true,
        };

        const webResults = await sendWebPushToUser(matched.id, payload);
        if (webResults.some((n) => n.sent)) usersNotified += 1;

        const userResult = await pool.query(
          'SELECT device_token FROM users WHERE id = $1 AND device_token IS NOT NULL',
          [matched.id]
        );
        if (userResult.rows.length > 0) {
          const fcmSent = await sendFcmNotification(
            userResult.rows[0].device_token,
            { title: payload.title, body: payload.body },
            payload
          );
          if (fcmSent) usersNotified += 1;
        }
      }
    }

    console.log(
      `Emergency contact ${contact.name} (${contact.phone || contact.email}) — app users notified: ${usersNotified}`
    );
    notifications.push({ contactId: contact.id, usersNotified });
  }

  return notifications;
}

module.exports = {
  initFirebase,
  sendFcmNotification,
  notifyNearbyUsers,
  notifyEmergencyContacts,
};
