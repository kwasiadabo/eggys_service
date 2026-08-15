// Polls for paid orders that have sat too long without being dispatched, and
// nudges staff (SMS + email) exactly once per order — see Order.dispatchReminderSentAt.
const { Op } = require('sequelize');
const { Order, User } = require('../models');
const { sendSms } = require('../services/naloSms');
const { sendEmail } = require('../services/email');
const { orderRecipient } = require('../services/orderNotify');

const REMINDER_AFTER_MS = 60 * 60 * 1000; // 1 hour

const OWNER_NOTIFICATION_EMAILS = (process.env.ORDER_NOTIFICATION_EMAILS || '')
  .split(',').map((e) => e.trim()).filter(Boolean);
const OWNER_NOTIFICATION_PHONES = (process.env.ORDER_NOTIFICATION_PHONES || '')
  .split(',').map((p) => p.trim()).filter(Boolean);

async function checkOverdueDispatches() {
  const cutoff = new Date(Date.now() - REMINDER_AFTER_MS);
  const overdue = await Order.findAll({
    where: {
      status: 'pending_delivery',
      confirmedAt: { [Op.lte]: cutoff },
      dispatchReminderSentAt: null,
    },
    include: [{ model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] }],
  });

  for (const order of overdue) {
    const { name } = orderRecipient(order);
    const minutesLate = Math.round((Date.now() - order.confirmedAt.getTime()) / 60000);
    const payload = {
      orderNumber: order.orderNumber,
      customerName: name || 'Guest',
      customerContact: order.User?.phoneNumber || order.guestPhone || order.User?.email || order.guestEmail || '—',
      amount: Number(order.totalAmount).toFixed(2),
      address: order.shippingAddress,
      minutesLate,
    };

    await Promise.all([
      ...OWNER_NOTIFICATION_EMAILS.map((ownerEmail) => sendEmail(ownerEmail, 'dispatch_reminder', payload)),
      ...OWNER_NOTIFICATION_PHONES.map((ownerPhone) => sendSms(ownerPhone, 'dispatch_reminder', payload)),
    ]).catch((err) => console.error('dispatch_reminder notification error:', err.message));

    order.dispatchReminderSentAt = new Date();
    await order.save();
  }

  return overdue.length;
}

module.exports = { checkOverdueDispatches };
