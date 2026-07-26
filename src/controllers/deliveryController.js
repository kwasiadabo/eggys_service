const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sequelize, DeliveryPerson, DeliveryFee, Order, OrderItem, Product, User, OrderStatusHistory } = require('../models');
const { sendSms } = require('../services/naloSms');
const { sendEmail } = require('../services/email');
const { buildRiderOwnReport } = require('../services/pdfReports');
const { orderRecipient, dispatchDetails } = require('../services/orderNotify');

/** Query params are plain <input type="date"> values (YYYY-MM-DD) — expand to whole-day bounds. */
function parseDateRange(query) {
  const from = query.from ? new Date(`${query.from}T00:00:00`) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = query.to ? new Date(`${query.to}T23:59:59.999`) : new Date();
  return { from, to };
}

async function fetchRiderOwnReport(riderId, { from, to }) {
  const assigned = await Order.findAll({
    where: { DeliveryPersonId: riderId, createdAt: { [Op.between]: [from, to] } },
    include: [{ model: User, attributes: ['firstName', 'lastName'] }],
    order: [['createdAt', 'ASC']],
  });
  const delivered = await Order.findAll({
    where: { DeliveryPersonId: riderId, status: 'delivered', deliveredAt: { [Op.between]: [from, to] } },
    include: [{ model: User, attributes: ['firstName', 'lastName'] }],
    order: [['deliveredAt', 'ASC']],
  });
  return {
    assigned,
    delivered,
    totals: {
      assignedCount: assigned.length,
      deliveredCount: delivered.length,
      deliveredAmount: delivered.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0),
      deliveredFees: delivered.reduce((sum, o) => sum + Number(o.shippingCost || 0), 0),
    },
  };
}

function generatePin() {
  return String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
}

/**
 * Ghana numbers get stored in whatever format an admin typed them in
 * (0XXXXXXXXX, 233XXXXXXXXX, +233 XX XXX XXXX, ...). Compare on the last 9
 * significant digits so a rider can log in regardless of which format was
 * used when their account was created.
 */
function normalizePhone(raw) {
  return String(raw || '').replace(/\D/g, '').slice(-9);
}

/** never expose credential hashes to the client */
function publicRider(person) {
  const { pinHash, passwordHash, ...rest } = person.toJSON();
  return { ...rest, hasPin: Boolean(pinHash), hasPassword: Boolean(passwordHash) };
}

// ---------- Delivery persons ----------

async function listPersons(_req, res, next) {
  try {
    const persons = await DeliveryPerson.findAll({ order: [['name', 'ASC']] });
    // active (not yet delivered) assignment counts per rider
    const [counts] = await sequelize.query(`
      SELECT DeliveryPersonId, COUNT(*) AS activeDeliveries
      FROM Orders
      WHERE DeliveryPersonId IS NOT NULL AND status NOT IN ('delivered', 'cancelled')
      GROUP BY DeliveryPersonId
    `);
    // MSSQL returns GUIDs uppercase from raw queries — normalize for the lookup
    const countMap = Object.fromEntries(
      counts.map((c) => [String(c.DeliveryPersonId).toLowerCase(), c.activeDeliveries])
    );
    res.json(persons.map((p) => ({
      ...publicRider(p),
      activeDeliveries: countMap[String(p.id).toLowerCase()] || 0,
    })));
  } catch (err) {
    next(err);
  }
}

async function createPerson(req, res, next) {
  try {
    const { name, phoneNumber } = req.body;
    if (!name || !phoneNumber) return res.status(400).json({ error: 'name and phoneNumber are required' });
    const pin = generatePin();
    const person = await DeliveryPerson.create({
      name,
      phoneNumber,
      pinHash: await bcrypt.hash(pin, 10),
    });
    const smsSent = Boolean(await sendSms(phoneNumber, 'rider_welcome', { name, pin }));
    // pin returned once so the admin can pass it on if the SMS fails
    res.status(201).json({ ...publicRider(person), pin, smsSent });
  } catch (err) {
    next(err);
  }
}

async function resetPin(req, res, next) {
  try {
    const person = await DeliveryPerson.findByPk(req.params.id);
    if (!person) return res.status(404).json({ error: 'Delivery person not found' });
    const pin = generatePin();
    // clears any existing password too — a PIN reset is the account-recovery path,
    // so the rider goes through the PIN + set-password flow again
    await person.update({ pinHash: await bcrypt.hash(pin, 10), passwordHash: null });
    const smsSent = Boolean(await sendSms(person.phoneNumber, 'rider_pin_reset', { name: person.name, pin }));
    res.json({ ...publicRider(person), pin, smsSent });
  } catch (err) {
    next(err);
  }
}

async function updatePerson(req, res, next) {
  try {
    const person = await DeliveryPerson.findByPk(req.params.id);
    if (!person) return res.status(404).json({ error: 'Delivery person not found' });
    const { name, phoneNumber, isActive } = req.body;
    await person.update({
      ...(name !== undefined && { name }),
      ...(phoneNumber !== undefined && { phoneNumber }),
      ...(isActive !== undefined && { isActive }),
    });
    res.json(person);
  } catch (err) {
    next(err);
  }
}

// ---------- Assignment & dispatch ----------

/**
 * Assigning is the planning step: orders are grouped onto riders while still
 * pending_delivery. No SMS is sent — the rider is notified once, at dispatch.
 */
async function assignOrder(req, res, next) {
  try {
    const { deliveryPersonId } = req.body; // null to unassign
    const order = await Order.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending_delivery') {
      return res.status(400).json({ error: `Only pending-delivery orders can be reassigned (this one is ${order.status})` });
    }

    let person = null;
    if (deliveryPersonId) {
      person = await DeliveryPerson.findByPk(deliveryPersonId);
      if (!person) return res.status(404).json({ error: 'Delivery person not found' });
      if (!person.isActive) return res.status(400).json({ error: `${person.name} is deactivated` });
    }

    order.DeliveryPersonId = person ? person.id : null;
    await order.save();
    res.json({ orderId: order.id, deliveryPersonId: order.DeliveryPersonId });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/delivery-persons/:id/dispatch — send a rider out with all of
 * their assigned pending-delivery orders (optionally limited to body.orderIds).
 * Orders become 'dispatched'; only dispatched orders can be confirmed delivered.
 */
async function dispatchRider(req, res, next) {
  try {
    const person = await DeliveryPerson.findByPk(req.params.id);
    if (!person) return res.status(404).json({ error: 'Delivery person not found' });
    if (!person.isActive) return res.status(400).json({ error: `${person.name} is deactivated` });

    const where = { DeliveryPersonId: person.id, status: 'pending_delivery' };
    const { orderIds } = req.body || {};
    if (Array.isArray(orderIds) && orderIds.length) where.id = { [Op.in]: orderIds };

    const orders = await Order.findAll({
      where,
      include: [User, { model: OrderItem, include: [Product] }],
      order: [['createdAt', 'ASC']],
    });
    if (!orders.length) {
      return res.status(400).json({ error: `${person.name} has no assigned orders awaiting dispatch` });
    }

    for (const order of orders) {
      order.status = 'dispatched';
      await order.save();
      const history = await OrderStatusHistory.create({ OrderId: order.id, status: 'dispatched' });
      const { phone, name, email } = orderRecipient(order);
      const d = dispatchDetails(order, person);

      // Fire notifications in the background — awaiting SMS + email per order
      // here made dispatching a multi-order run take as long as every provider
      // round-trip added together, blocking the admin's response.
      Promise.all([
        phone && sendSms(phone, 'order_shipped', {
          name,
          orderNumber: order.orderNumber,
          items: d.itemsText,
          riderName: d.riderName,
          riderPhone: d.riderPhone,
          eta: d.eta,
        }),
        email && sendEmail(email, 'order_shipped', {
          name,
          orderNumber: order.orderNumber,
          items: d.items,
          riderName: d.riderName,
          riderPhone: d.riderPhone,
          eta: d.eta,
          address: order.shippingAddress,
        }),
      ]).then(([smsResult, emailResult]) => {
        if (smsResult || emailResult) {
          history.smsSentAt = new Date();
          return history.save();
        }
      }).catch((err) => console.error('order_shipped notification error:', err.message));
    }

    // one SMS covering the whole run — also backgrounded so it doesn't add to
    // the response time on top of the per-order notifications above.
    const stops = orders
      .map((o, i) => `${i + 1}) ${o.orderNumber} - ${o.shippingAddress}`)
      .join('; ');
    sendSms(person.phoneNumber, 'rider_dispatch', {
      name: person.name,
      count: orders.length,
      stops,
    }).catch((err) => console.error('rider_dispatch notification error:', err.message));

    res.json({
      deliveryPersonId: person.id,
      dispatched: orders.map((o) => ({ id: o.id, orderNumber: o.orderNumber })),
    });
  } catch (err) {
    next(err);
  }
}

// ---------- Rider portal ----------

// riders only ever see and act on orders that have been dispatched to them
const ACTIVE_DELIVERY_STATUSES = ['dispatched'];

/**
 * POST /rider/login { phone, credential } — issues a rider JWT.
 * Before a rider has set a password, `credential` is checked against the SMS
 * PIN and the token comes back flagged mustSetPassword so the client is
 * routed straight to password setup. Once a password exists, the PIN is
 * retired and `credential` is checked against it instead.
 */
async function riderLogin(req, res, next) {
  try {
    const { phone, credential } = req.body;
    if (!phone || !credential) return res.status(400).json({ error: 'phone and credential are required' });
    const normalizedPhone = normalizePhone(phone);
    const activeRiders = await DeliveryPerson.findAll({ where: { isActive: true } });
    const rider = normalizedPhone
      ? activeRiders.find((r) => normalizePhone(r.phoneNumber) === normalizedPhone)
      : null;
    if (!rider) return res.status(401).json({ error: 'Invalid phone number or credential' });

    const usingPassword = Boolean(rider.passwordHash);
    const hash = usingPassword ? rider.passwordHash : rider.pinHash;
    if (!hash || !(await bcrypt.compare(String(credential), hash))) {
      return res.status(401).json({ error: 'Invalid phone number or credential' });
    }

    const mustSetPassword = !usingPassword;
    const token = jwt.sign(
      { id: rider.id, name: rider.name, role: 'rider', mustSetPassword },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, rider: { id: rider.id, name: rider.name }, mustSetPassword });
  } catch (err) {
    next(err);
  }
}

/** POST /rider/set-password { password } — required after a first PIN login; re-issues the JWT without the flag. */
async function riderSetPassword(req, res, next) {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const rider = await DeliveryPerson.findOne({ where: { id: req.rider.id, isActive: true } });
    if (!rider) return res.status(404).json({ error: 'Rider account not found or deactivated' });

    await rider.update({ passwordHash: await bcrypt.hash(password, 10) });

    const token = jwt.sign(
      { id: rider.id, name: rider.name, role: 'rider', mustSetPassword: false },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, rider: { id: rider.id, name: rider.name } });
  } catch (err) {
    next(err);
  }
}

/** GET /rider/deliveries — the authenticated rider's active deliveries. */
async function riderDeliveries(req, res, next) {
  try {
    const rider = await DeliveryPerson.findOne({ where: { id: req.rider.id, isActive: true } });
    if (!rider) return res.status(404).json({ error: 'Rider account not found or deactivated' });

    const orders = await Order.findAll({
      where: { DeliveryPersonId: rider.id, status: { [Op.in]: ACTIVE_DELIVERY_STATUSES } },
      include: [
        { model: User, attributes: ['firstName', 'lastName', 'phoneNumber'] },
        { model: OrderItem, include: [{ model: Product, attributes: ['name'] }] },
      ],
      order: [['createdAt', 'ASC']],
    });
    res.json({ rider: { id: rider.id, name: rider.name }, orders });
  } catch (err) {
    next(err);
  }
}

/** POST /rider/deliveries/:id/confirm — rider marks an order as delivered. */
async function riderConfirmDelivery(req, res, next) {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, DeliveryPersonId: req.rider.id },
      include: [User],
    });
    if (!order) return res.status(404).json({ error: 'Order not found or not assigned to you' });
    if (order.status !== 'dispatched') {
      return res.status(400).json({
        error: order.status === 'pending_delivery'
          ? 'This order has not been dispatched to you yet — it cannot be delivered'
          : `Order is already ${order.status}`,
      });
    }

    order.status = 'delivered';
    order.deliveredAt = new Date();
    await order.save();

    const history = await OrderStatusHistory.create({ OrderId: order.id, status: 'delivered' });
    const { phone, name, email } = orderRecipient(order);
    Promise.all([
      phone && sendSms(phone, 'order_delivered', { name, orderNumber: order.orderNumber }),
      email && sendEmail(email, 'order_delivered', { name, orderNumber: order.orderNumber }),
    ]).then(([smsResult, emailResult]) => {
      if (smsResult || emailResult) {
        history.smsSentAt = new Date();
        return history.save();
      }
    }).catch((err) => console.error('order_delivered notification error:', err.message));
    res.json({ orderId: order.id, orderNumber: order.orderNumber, status: order.status });
  } catch (err) {
    next(err);
  }
}

/** GET /rider/report?from&to — the rider's own assigned + delivered orders in a date range. */
async function riderReport(req, res, next) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { assigned, delivered, totals } = await fetchRiderOwnReport(req.rider.id, { from, to });
    res.json({ from, to, assigned, delivered, totals });
  } catch (err) {
    next(err);
  }
}

/** GET /rider/report.pdf?from&to — same report, as a downloadable PDF. */
async function riderReportPdf(req, res, next) {
  try {
    const rider = await DeliveryPerson.findByPk(req.rider.id);
    if (!rider) return res.status(404).json({ error: 'Rider account not found' });
    const { from, to } = parseDateRange(req.query);
    const { assigned, delivered } = await fetchRiderOwnReport(req.rider.id, { from, to });
    const doc = buildRiderOwnReport({ from, to, rider, assigned, delivered });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="my-report-${req.query.from || 'last30'}-${req.query.to || 'now'}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    next(err);
  }
}

// ---------- Delivery fees ----------

async function listFees(_req, res, next) {
  try {
    res.json(await DeliveryFee.findAll({ order: [['region', 'ASC'], ['city', 'ASC']] }));
  } catch (err) {
    next(err);
  }
}

async function upsertFee(req, res, next) {
  try {
    const { region, city = 'Other', fee } = req.body;
    if (!region || !city.trim() || fee === undefined || Number(fee) < 0) {
      return res.status(400).json({ error: 'region, city and a non-negative fee are required' });
    }
    const [record, created] = await DeliveryFee.findOrCreate({
      where: { region, city: city.trim() },
      defaults: { fee },
    });
    if (!created) await record.update({ fee });
    res.status(created ? 201 : 200).json(record);
  } catch (err) {
    next(err);
  }
}

async function removeFee(req, res, next) {
  try {
    const record = await DeliveryFee.findByPk(req.params.id);
    if (!record) return res.status(404).json({ error: 'Fee not found' });
    if (record.city === 'Other') {
      return res.status(400).json({ error: "The 'Other' fallback fee for a region cannot be deleted" });
    }
    await record.destroy();
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPersons, createPerson, updatePerson, resetPin, assignOrder, dispatchRider,
  riderLogin, riderSetPassword, riderDeliveries, riderConfirmDelivery, riderReport, riderReportPdf,
  listFees, upsertFee, removeFee,
};
