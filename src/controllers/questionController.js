const { Question, User } = require('../models');
const { sendEmail } = require('../services/email');

const STATUSES = ['open', 'answered'];

const OWNER_NOTIFICATION_EMAILS = (process.env.ORDER_NOTIFICATION_EMAILS || '')
  .split(',').map((e) => e.trim()).filter(Boolean);

/** Registered askers have a User association; guests fall back to the guest* fields. */
function questionRecipient(q) {
  return {
    name: q.User?.firstName || q.guestName,
    email: q.User?.email || q.guestEmail,
  };
}

async function create(req, res, next) {
  try {
    const { question } = req.body;
    if (!question?.trim()) {
      return res.status(400).json({ error: 'question is required' });
    }

    let guestName = null;
    let guestEmail = null;
    let guestPhone = null;
    if (!req.user) {
      ({ guestName, guestEmail, guestPhone } = req.body);
      if (!guestName?.trim() || !guestEmail?.trim()) {
        return res.status(400).json({ error: 'guestName and guestEmail are required' });
      }
    }

    const created = await Question.create({
      question: question.trim(),
      UserId: req.user?.id || null,
      guestName: guestName?.trim() || null,
      guestEmail: guestEmail?.trim() || null,
      guestPhone: guestPhone?.trim() || null,
    });
    res.status(201).json(created);

    // Store-owner notification — fire-and-forget, never blocks the response.
    Promise.all(
      OWNER_NOTIFICATION_EMAILS.map((ownerEmail) => sendEmail(ownerEmail, 'owner_new_question', {
        askerName: req.user?.email || guestName || 'Guest',
        askerContact: req.user?.email || guestEmail || guestPhone || '—',
        question: question.trim(),
      })),
    ).catch((err) => console.error('owner_new_question notification error:', err.message));
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const questions = await Question.findAll({
      where: { UserId: req.user.id },
      order: [['createdAt', 'DESC']],
    });
    res.json(questions);
  } catch (err) {
    next(err);
  }
}

/** GET /admin/questions/open-count — cheap poll target for the admin sidebar badge/alert. */
async function openCount(_req, res, next) {
  try {
    const count = await Question.count({ where: { status: 'open' } });
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

async function listAll(req, res, next) {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const questions = await Question.findAll({
      where,
      include: [{ model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(questions);
  } catch (err) {
    next(err);
  }
}

async function respond(req, res, next) {
  try {
    const { answer, status } = req.body;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const question = await Question.findByPk(req.params.id, { include: [User] });
    if (!question) return res.status(404).json({ error: 'Question not found' });

    if (answer?.trim()) {
      question.answer = answer.trim();
      question.answeredAt = new Date();
    }
    question.status = status || (answer?.trim() ? 'answered' : question.status);
    await question.save();
    res.json(question);

    if (answer?.trim()) {
      const { name, email } = questionRecipient(question);
      if (email) {
        sendEmail(email, 'question_answered', {
          name: name || 'there',
          question: question.question,
          answer: question.answer,
        }).catch((err) => console.error('question_answered notification error:', err.message));
      }
    }
  } catch (err) {
    next(err);
  }
}

module.exports = { create, listMine, listAll, respond, openCount, STATUSES };
