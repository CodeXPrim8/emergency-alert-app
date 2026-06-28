const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.purpose === 'live_broadcast') {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function authenticateUserOrLiveBroadcast(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.purpose === 'live_broadcast') {
      if (decoded.alertId !== req.params.id) {
        return res.status(403).json({ error: 'Token not valid for this alert' });
      }
      req.user = { userId: decoded.userId, alertId: decoded.alertId, liveBroadcast: true };
      return next();
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate, authenticateUserOrLiveBroadcast };
