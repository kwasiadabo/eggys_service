const jwt = require('jsonwebtoken');
const { User, DeliveryPerson } = require('../models');

function verifyBearer(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const payload = verifyBearer(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  req.user = payload;
  next();
}

/** Decodes a bearer token into req.user if present, but never rejects — for routes usable by both signed-in and guest requests. */
function optionalAuth(req, _res, next) {
  const payload = verifyBearer(req);
  if (payload) req.user = payload;
  next();
}

/**
 * Re-checks admin status against the DB on every request instead of trusting
 * the JWT payload alone — tokens live for 7 days, so without this, revoking
 * someone's admin access (or suspending their account) wouldn't take effect
 * until their token naturally expires.
 */
async function requireAdmin(req, res, next) {
  const payload = verifyBearer(req);
  if (!payload) return res.status(401).json({ error: 'Authentication required' });
  try {
    const user = await User.findByPk(payload.id, { attributes: ['isAdmin', 'accountStatus'] });
    if (!user || !user.isAdmin || user.accountStatus !== 'active') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    req.user = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/** Same freshness concern as requireAdmin — a deactivated rider's existing token shouldn't keep working. */
async function requireRider(req, res, next) {
  const payload = verifyBearer(req);
  if (!payload) return res.status(401).json({ error: 'Rider authentication required' });
  if (payload.role !== 'rider') return res.status(403).json({ error: 'Rider access required' });
  try {
    const rider = await DeliveryPerson.findByPk(payload.id, { attributes: ['isActive'] });
    if (!rider || !rider.isActive) return res.status(403).json({ error: 'Rider account deactivated' });
    req.rider = payload;
    next();
  } catch (err) {
    next(err);
  }
}

/** Blocks everything but password setup until a first-time (PIN-login) rider sets a password. */
function requireRiderPasswordSet(req, res, next) {
  if (req.rider?.mustSetPassword) {
    return res.status(403).json({ error: 'Set a password before continuing', code: 'PASSWORD_SETUP_REQUIRED' });
  }
  next();
}

module.exports = { requireAuth, optionalAuth, requireAdmin, requireRider, requireRiderPasswordSet };
