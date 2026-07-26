const { Issue, Order, User } = require('../models');

const CATEGORIES = ['non_delivery', 'bad_product', 'wrong_item', 'damaged', 'other'];
const STATUSES = ['open', 'in_progress', 'resolved'];

async function create(req, res, next) {
  try {
    const { category, description, orderId } = req.body;
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${CATEGORIES.join(', ')}` });
    }
    if (!description?.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }

    let order = null;
    if (orderId) {
      order = await Order.findOne({ where: { id: orderId, UserId: req.user.id } });
      if (!order) return res.status(404).json({ error: 'Order not found' });
    }

    const issue = await Issue.create({
      category,
      description: description.trim(),
      UserId: req.user.id,
      OrderId: order?.id || null,
    });
    res.status(201).json(issue);
  } catch (err) {
    next(err);
  }
}

async function listMine(req, res, next) {
  try {
    const issues = await Issue.findAll({
      where: { UserId: req.user.id },
      include: [{ model: Order, attributes: ['orderNumber'] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(issues);
  } catch (err) {
    next(err);
  }
}

/** GET /admin/issues/open-count — cheap poll target for the admin sidebar badge/alert. */
async function openCount(_req, res, next) {
  try {
    const count = await Issue.count({ where: { status: 'open' } });
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

async function listAll(req, res, next) {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;
    const issues = await Issue.findAll({
      where,
      include: [
        { model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] },
        { model: Order, attributes: ['orderNumber'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    res.json(issues);
  } catch (err) {
    next(err);
  }
}

async function respond(req, res, next) {
  try {
    const { response, status } = req.body;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });
    }
    const issue = await Issue.findByPk(req.params.id);
    if (!issue) return res.status(404).json({ error: 'Issue not found' });

    if (response?.trim()) {
      issue.adminResponse = response.trim();
      issue.respondedAt = new Date();
    }
    issue.status = status || (response?.trim() ? 'resolved' : issue.status);
    await issue.save();
    res.json(issue);
  } catch (err) {
    next(err);
  }
}

module.exports = { create, listMine, listAll, respond, openCount, CATEGORIES, STATUSES };
