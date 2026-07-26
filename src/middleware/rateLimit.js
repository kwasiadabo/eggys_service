const rateLimit = require('express-rate-limit');

/** Baseline for all /api traffic — blunts floods/abuse without affecting normal usage. */
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Credential-guessing endpoints (customer login, rider PIN/password login,
 * registration). Rider login in particular is phone + a 6-digit numeric PIN
 * with no other lockout — this is what actually bounds the guess rate.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later' },
});

/** Public order lookup takes an order number + contact as its only "credential". */
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again later' },
});

module.exports = { apiLimiter, authLimiter, lookupLimiter };
