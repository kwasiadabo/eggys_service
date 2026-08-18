// Two-stage handling of orders whose Paystack payment was never completed:
// nudge the customer once at 12h still pending, then release the reserved
// stock and cancel the order if payment still hasn't landed by 24h. Both
// stages re-verify with Paystack first — a missed webhook, not a genuinely
// abandoned checkout, is sometimes the real reason an order still looks unpaid.
const { Op } = require('sequelize');
const { sequelize, Order, OrderItem, Product, Inventory, InventoryLog, User, OrderStatusHistory } = require('../models');
const paystack = require('../services/paystack');
const { sendSms } = require('../services/naloSms');
const { sendEmail } = require('../services/email');
const { orderRecipient } = require('../services/orderNotify');
const { markOrderPaidAndNotify } = require('../controllers/orderController');

const REMINDER_AFTER_MS = 12 * 60 * 60 * 1000;
const CANCEL_AFTER_MS = 24 * 60 * 60 * 1000;

const orderInclude = [User, { model: OrderItem, include: [Product] }];

/**
 * Re-checks with Paystack in case the order only *looks* unpaid because a
 * webhook was missed. Returns the verified payload if it actually succeeded,
 * null if Paystack confirms it's genuinely unpaid, or undefined if the check
 * itself failed (network/API error) — callers should skip the order and let
 * the next run retry rather than act on an inconclusive result.
 */
async function checkPaidElsewhere(order) {
  try {
    const verified = await paystack.verifyTransaction(order.paystackReference);
    return verified.status === 'success' ? verified : null;
  } catch (err) {
    console.error(`paystack verify failed for ${order.orderNumber}:`, err.message);
    return undefined;
  }
}

async function sendPaymentReminder(order) {
  const { phone, name, email } = orderRecipient(order);
  const payload = { name: name || 'there', orderNumber: order.orderNumber, amount: Number(order.totalAmount).toFixed(2) };
  await Promise.all([
    phone && sendSms(phone, 'payment_reminder', payload),
    email && sendEmail(email, 'payment_reminder', payload),
  ]);
  order.paymentReminderSentAt = new Date();
  await order.save();
}

async function cancelUnpaidOrder(order) {
  const t = await sequelize.transaction();
  try {
    for (const item of order.OrderItems) {
      const inv = await Inventory.findOne({ where: { ProductId: item.ProductId }, transaction: t });
      if (inv) {
        inv.quantityInStock += item.quantity;
        await inv.save({ transaction: t });
      }
      await InventoryLog.create({
        ProductId: item.ProductId,
        action: 'adjusted',
        quantityChange: item.quantity,
        referenceId: order.id,
      }, { transaction: t });
    }
    order.status = 'cancelled';
    await order.save({ transaction: t });
    await OrderStatusHistory.create({ OrderId: order.id, status: 'cancelled' }, { transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    throw err;
  }

  const { phone, name, email } = orderRecipient(order);
  const payload = { name: name || 'there', orderNumber: order.orderNumber, amount: Number(order.totalAmount).toFixed(2) };
  await Promise.all([
    phone && sendSms(phone, 'order_cancelled_unpaid', payload),
    email && sendEmail(email, 'order_cancelled_unpaid', payload),
  ]).catch((err) => console.error('order_cancelled_unpaid notification error:', err.message));
}

async function checkUnpaidOrders() {
  const now = Date.now();
  let reminded = 0;
  let cancelled = 0;

  const dueForReminder = await Order.findAll({
    where: {
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: { [Op.lte]: new Date(now - REMINDER_AFTER_MS) },
      paymentReminderSentAt: null,
    },
    include: orderInclude,
  });
  for (const order of dueForReminder) {
    const verified = await checkPaidElsewhere(order);
    if (verified === undefined) continue;
    if (verified) { await markOrderPaidAndNotify(order, verified); continue; }
    await sendPaymentReminder(order);
    reminded++;
  }

  const dueForCancel = await Order.findAll({
    where: {
      status: 'pending',
      paymentStatus: 'pending',
      createdAt: { [Op.lte]: new Date(now - CANCEL_AFTER_MS) },
    },
    include: orderInclude,
  });
  for (const order of dueForCancel) {
    const verified = await checkPaidElsewhere(order);
    if (verified === undefined) continue;
    if (verified) { await markOrderPaidAndNotify(order, verified); continue; }
    await cancelUnpaidOrder(order);
    cancelled++;
  }

  return { reminded, cancelled };
}

module.exports = { checkUnpaidOrders };
