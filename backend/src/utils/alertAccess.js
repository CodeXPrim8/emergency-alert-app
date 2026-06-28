const pool = require('../db/pool');

async function getAlertOwnerId(alertId) {
  const result = await pool.query('SELECT user_id, status FROM alerts WHERE id = $1', [alertId]);
  return result.rows[0] || null;
}

async function canAccessAlertMedia(viewerUserId, alertId) {
  const alert = await getAlertOwnerId(alertId);
  if (!alert) return { allowed: false, reason: 'not_found' };
  if (alert.user_id === viewerUserId) {
    return { allowed: true, ownerId: alert.user_id, status: alert.status };
  }

  const result = await pool.query(
    `SELECT 1 AS ok
     FROM emergency_contacts ec
     JOIN users u ON u.id = $2
     WHERE ec.user_id = $1
       AND (
         (ec.phone IS NOT NULL AND ec.phone != '' AND u.phone IS NOT NULL AND ec.phone = u.phone)
         OR (ec.email IS NOT NULL AND ec.email != '' AND u.email IS NOT NULL AND ec.email = u.email)
       )
     LIMIT 1`,
    [viewerUserId, alert.user_id]
  );

  if (result.rows.length === 0) {
    return { allowed: false, reason: 'forbidden', ownerId: alert.user_id, status: alert.status };
  }

  return { allowed: true, ownerId: alert.user_id, status: alert.status, isContact: true };
}

module.exports = { canAccessAlertMedia, getAlertOwnerId };
