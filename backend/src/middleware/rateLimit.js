const rateLimit = require('express-rate-limit');
const config = require('../config');

const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const emergencyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Emergency alert rate limit exceeded' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts' },
});

module.exports = { generalLimiter, emergencyLimiter, authLimiter };
