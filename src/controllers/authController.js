const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { User } = require('../models');

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function publicUser(user) {
  const { id, firstName, lastName, email, phoneNumber, isAdmin } = user;
  return { id, firstName, lastName, email, phoneNumber, isAdmin };
}

async function register(req, res, next) {
  try {
    const { firstName, lastName, email, password, phoneNumber } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'firstName, lastName, email and password are required' });
    }
    const existing = await User.findOne({ where: { email } });
    if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ firstName, lastName, email, passwordHash, phoneNumber });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ where: { email } });
    if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ error: 'Account is suspended' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(publicUser(user));
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, me };
