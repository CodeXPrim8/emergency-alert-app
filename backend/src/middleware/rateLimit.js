const rateLimit = require('express-rate-limit');
const config = require('../config');

function createLimiter(options) {
  if (process.env.VERCEL || config.nodeEnv === 'development') {
    return (req, res, next) => next();
  }
  return rateLimit(options);
}

const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many failed sign-in attempts. Wait a few minutes and try again.' },
});

const emergencyLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Emergency alert rate limit exceeded' },
});

module.exports = { loginLimiter, emergencyLimiter };
