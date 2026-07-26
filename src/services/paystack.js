const axios = require('axios');
const crypto = require('crypto');

const BASE_URL = 'https://api.paystack.co';

function authHeaders() {
  return { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` };
}

/**
 * Initialize a Paystack transaction. Amount is in major units (GHS);
 * Paystack expects the smallest unit (pesewas), hence the *100.
 * Returns { authorization_url, access_code, reference }.
 */
async function initializeTransaction({ email, amount, reference, metadata }) {
  const { data } = await axios.post(
    `${BASE_URL}/transaction/initialize`,
    {
      email,
      amount: Math.round(Number(amount) * 100),
      reference,
      currency: process.env.PAYSTACK_CURRENCY || 'GHS',
      callback_url: `${process.env.CLIENT_URL}/checkout/complete`,
      metadata,
    },
    { headers: authHeaders() }
  );
  return data.data;
}

/** Server-side verification of a transaction by reference. */
async function verifyTransaction(reference) {
  const { data } = await axios.get(
    `${BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: authHeaders() }
  );
  return data.data; // status === 'success' when paid
}

/**
 * Paystack signs webhooks with HMAC-SHA512 of the raw body using your secret key.
 * Always verify before trusting the event.
 */
function isValidWebhookSignature(rawBody, signature) {
  if (!rawBody || !signature) return false;
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest('hex');
  return hash === signature;
}

module.exports = { initializeTransaction, verifyTransaction, isValidWebhookSignature };
