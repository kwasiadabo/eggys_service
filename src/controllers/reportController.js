const { Op } = require('sequelize');
const { Order, User, DeliveryPerson } = require('../models');
const { buildOrdersReport, buildRiderDeliveriesReport } = require('../services/pdfReports');

/** Query params are plain <input type="date"> values (YYYY-MM-DD) — expand to whole-day bounds. */
function parseDateRange(query) {
  const from = query.from ? new Date(`${query.from}T00:00:00`) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = query.to ? new Date(`${query.to}T23:59:59.999`) : new Date();
  return { from, to };
}

function pipePdf(res, doc, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  doc.end();
}

async function fetchOrdersForReport({ from, to }) {
  const orders = await Order.findAll({
    where: { createdAt: { [Op.between]: [from, to] } },
    include: [{ model: User, attributes: ['firstName', 'lastName'] }],
    order: [['createdAt', 'ASC']],
  });
  const totals = {
    orders: orders.length,
    totalProduct: orders.reduce((sum, o) => sum + Number(o.subtotal || 0), 0),
    totalDelivery: orders.reduce((sum, o) => sum + Number(o.shippingCost || 0), 0),
    grandTotal: orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0),
  };
  return { orders, totals };
}

async function fetchRiderDeliveriesForReport({ from, to }) {
  const orders = await Order.findAll({
    where: { status: 'delivered', deliveredAt: { [Op.between]: [from, to] } },
    include: [
      { model: User, attributes: ['firstName', 'lastName'] },
      { model: DeliveryPerson, attributes: ['id', 'name', 'phoneNumber'] },
    ],
    order: [['deliveredAt', 'ASC']],
  });

  const byRider = new Map();
  for (const order of orders) {
    if (!order.DeliveryPerson) continue; // shouldn't happen for delivered orders, but stay defensive
    const key = order.DeliveryPerson.id;
    if (!byRider.has(key)) byRider.set(key, { rider: order.DeliveryPerson, orders: [] });
    byRider.get(key).orders.push(order);
  }
  const riderGroups = [...byRider.values()].sort((a, b) => a.rider.name.localeCompare(b.rider.name));
  const totals = {
    riders: riderGroups.length,
    deliveries: orders.length,
    grandTotal: riderGroups.reduce(
      (sum, g) => sum + g.orders.reduce((s, o) => s + Number(o.totalAmount || 0), 0),
      0
    ),
  };
  return { riderGroups, totals };
}

// ---------- JSON previews (rendered on-screen before download) ----------

async function ordersJson(req, res, next) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { orders, totals } = await fetchOrdersForReport({ from, to });
    res.json({ from, to, orders, totals });
  } catch (err) {
    next(err);
  }
}

async function riderDeliveriesJson(req, res, next) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { riderGroups, totals } = await fetchRiderDeliveriesForReport({ from, to });
    res.json({ from, to, riderGroups, totals });
  } catch (err) {
    next(err);
  }
}

// ---------- PDF exports ----------

async function ordersPdf(req, res, next) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { orders } = await fetchOrdersForReport({ from, to });
    const doc = buildOrdersReport({ from, to, orders });
    pipePdf(res, doc, `orders-report-${req.query.from || 'last30'}-${req.query.to || 'now'}.pdf`);
  } catch (err) {
    next(err);
  }
}

async function riderDeliveriesPdf(req, res, next) {
  try {
    const { from, to } = parseDateRange(req.query);
    const { riderGroups } = await fetchRiderDeliveriesForReport({ from, to });
    const doc = buildRiderDeliveriesReport({ from, to, riderGroups });
    pipePdf(res, doc, `rider-deliveries-report-${req.query.from || 'last30'}-${req.query.to || 'now'}.pdf`);
  } catch (err) {
    next(err);
  }
}

module.exports = { ordersJson, riderDeliveriesJson, ordersPdf, riderDeliveriesPdf };
