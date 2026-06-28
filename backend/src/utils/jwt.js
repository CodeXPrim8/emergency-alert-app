const jwt = require('jsonwebtoken');
const config = require('../config');

function signToken(payload) {
  return jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function signLiveToken(alertId, userId) {
  return jwt.sign(
    { alertId, userId, purpose: 'live_broadcast' },
    config.jwt.secret,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, config.jwt.secret);
}

module.exports = { signToken, signLiveToken, verifyToken };
