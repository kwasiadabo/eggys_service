const axios = require('axios');
const { NotificationLog } = require('../models');

const templates = {
  order_confirmed: (p) =>
    `Hi ${p.name}, your VX Perfumery order ${p.orderNumber} (GHS ${p.amount}) is confirmed. We'll text you when it ships. Thank you!`,
  order_shipped: (p) =>
    `Hi ${p.name}, your VX Perfumery order ${p.orderNumber} (${p.items}) has been dispatched. Rider: ${p.riderName} (${p.riderPhone}). Estimated delivery: ${p.eta}. Rider will call you to arrange delivery.`,
  order_delivered: (p) =>
    `Hi ${p.name}, your VX Perfumery order ${p.orderNumber} has been delivered. Thank you for shopping with us — we hope you enjoy your fragrance and look forward to serving you again!`,
  payment_failed: (p) =>
    `Hi ${p.name}, payment for VX Perfumery order ${p.orderNumber} failed. Please try again from your account page.`,
  low_stock_alert: (p) =>
    `VX Perfumery stock alert: ${p.productName} is low (${p.quantity} left).`,
  delivery_assignment: (p) =>
    `VX Perfumery delivery: Order ${p.orderNumber} (${p.items}) to ${p.address}. Customer: ${p.customerName} ${p.customerPhone}`,
  rider_dispatch: (p) =>
    `VX Perfumery dispatch: Hi ${p.name}, you have ${p.count} ${p.count === 1 ? 'delivery' : 'deliveries'}: ${p.stops} Confirm each one in the Rider Portal.`,
  rider_welcome: (p) =>
    `Welcome to the VX Perfumery delivery team, ${p.name}! Your rider login PIN is ${p.pin}. Sign in with your phone number at the Rider Portal.`,
  rider_pin_reset: (p) =>
    `Hi ${p.name}, your VX Perfumery rider PIN has been reset. New PIN: ${p.pin}`,
};

/** Nalo requires international format: 0241234567 -> 233241234567 */
function normalizeMsisdn(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`;
  return digits;
}

/**
 * Send an SMS via Nalo and record the attempt in NotificationLog.
 * Never throws — a failed SMS must not break order processing.
 */
async function sendSms(phoneNumber, messageType, params = {}) {
  const template = templates[messageType];
  if (!template || !phoneNumber) return null;
  const message = template(params);
  const msisdn = normalizeMsisdn(phoneNumber);

  const log = { recipient: msisdn, messageType, provider: 'nalo_sms' };
  try {
    const { data } = await axios.post(process.env.NALO_ENDPOINT, {
      key: process.env.NALO_API_KEY,
      msisdn,
      sender_id: process.env.NALO_SENDER_ID || 'VXPerfumery',
      message,
    });
    await NotificationLog.create({ ...log, status: 'sent', externalReferenceId: String(data?.job_id || data?.msg_id || '') });
    return data;
  } catch (err) {
    // Nalo's actual reason (e.g. "IP is not whitelisted") is in the response
    // body, not err.message — axios only gives the generic HTTP status there.
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`Nalo SMS failed (${messageType} → ${phoneNumber}):`, detail);
    await NotificationLog.create({ ...log, status: 'failed', errorMessage: detail }).catch(() => {});
    return null;
  }
}

module.exports = { sendSms, templates };
