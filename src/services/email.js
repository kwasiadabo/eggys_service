const nodemailer = require('nodemailer');
const dns = require('dns').promises;
const { NotificationLog } = require('../models');

const GMAIL_HOST = 'smtp.gmail.com';
const GMAIL_PORT = 465;
const IP_CACHE_MS = 5 * 60 * 1000;

// nodemailer resolves both A and AAAA records for the SMTP host and then picks
// one at RANDOM to connect to (see nodemailer/lib/shared/index.js formatDNSValue)
// instead of preferring IPv4 — so on networks with broken/partial IPv6 routing
// this intermittently connects over IPv6 and fails with ENETUNREACH, or hangs
// until connectionTimeout. Passing a `family` option does nothing (it isn't
// read anywhere in that resolution path). The only reliable fix is to resolve
// an IPv4 address ourselves and hand nodemailer a literal IP as `host` — a
// literal IP short-circuits its own DNS resolution entirely. `servername` is
// set explicitly so TLS SNI/cert validation still checks against the real
// hostname instead of the IP.
let cachedIPv4 = null;
let cachedIPv4At = 0;
async function resolveGmailIPv4() {
  if (cachedIPv4 && Date.now() - cachedIPv4At < IP_CACHE_MS) return cachedIPv4;
  try {
    const addresses = await dns.resolve4(GMAIL_HOST);
    if (addresses.length) {
      cachedIPv4 = addresses[Math.floor(Math.random() * addresses.length)];
      cachedIPv4At = Date.now();
    }
  } catch (err) {
    console.error('Failed to resolve smtp.gmail.com over IPv4, falling back to hostname:', err.message);
  }
  return cachedIPv4;
}

const BRAND = {
  name: 'VX Perfumery',
  tagline: 'Fine Fragrances, Delivered',
  dark: '#1a1a1a',
  gold: '#c9a227',
  cream: '#faf7f2',
  muted: '#6b6b6b',
};

// Lazily created so a missing EMAIL_USER/EMAIL_APP_PASSWORD doesn't crash the
// server at boot — it just disables email sending until configured. Rebuilt
// per send (cheap — createTransport does no I/O) so the resolved IP can be
// refreshed as resolveGmailIPv4()'s cache expires.
async function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) return null;
  const ip = await resolveGmailIPv4();
  return nodemailer.createTransport({
    host: ip || GMAIL_HOST,
    port: GMAIL_PORT,
    secure: true,
    servername: GMAIL_HOST,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_APP_PASSWORD },
    // Fail fast instead of hanging up to nodemailer's ~2min default — order
    // processing awaits this and a stuck connection shouldn't stall it.
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
}

function currency(n) {
  return `GHS ${Number(n || 0).toFixed(2)}`;
}

function itemsTable(items = []) {
  if (!items.length) return '';
  const rows = items
    .map(
      (i) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:${BRAND.dark};font-size:14px;">${i.name}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:${BRAND.muted};font-size:14px;text-align:center;">${i.quantity}</td>
      <td style="padding:10px 0;border-bottom:1px solid #eee;color:${BRAND.dark};font-size:14px;text-align:right;">${currency(i.subtotal)}</td>
    </tr>`
    )
    .join('');
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border-collapse:collapse;">
      <thead>
        <tr>
          <th align="left" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};padding-bottom:8px;border-bottom:2px solid ${BRAND.dark};">Item</th>
          <th align="center" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};padding-bottom:8px;border-bottom:2px solid ${BRAND.dark};">Qty</th>
          <th align="right" style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};padding-bottom:8px;border-bottom:2px solid ${BRAND.dark};">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Email-safe (table-based, inline-styled) layout — works across Gmail/Outlook/Apple Mail. */
function layout({ preheader = '', title, bodyHtml }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:${BRAND.cream};font-family:Georgia,'Times New Roman',serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:${BRAND.dark};padding:28px 32px;text-align:center;">
                <div style="color:${BRAND.gold};font-size:22px;letter-spacing:0.18em;font-weight:bold;">VX PERFUMERY</div>
                <div style="color:#cfcfcf;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;margin-top:4px;">${BRAND.tagline}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background:#f4f1ec;padding:20px 32px;text-align:center;">
                <div style="font-size:12px;color:${BRAND.muted};">VX Perfumery &middot; Accra, Ghana</div>
                <div style="font-size:12px;color:${BRAND.muted};margin-top:4px;">Questions about your order? Just reply to this email.</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

const templates = {
  order_confirmed: (p) => ({
    subject: `Order Confirmed — ${p.orderNumber}`,
    html: layout({
      title: 'Order Confirmed',
      preheader: `Payment received for order ${p.orderNumber} — here's what happens next`,
      bodyHtml: `
        <table role="presentation" width="100%" style="background:#f0f7f0;border-radius:6px;margin-bottom:20px;">
          <tr>
            <td style="padding:14px 16px;">
              <span style="display:inline-block;width:18px;height:18px;border-radius:50%;background:#2e7d32;color:#fff;font-size:12px;line-height:18px;text-align:center;margin-right:8px;">&#10003;</span>
              <span style="font-size:14px;color:#2e7d32;font-weight:bold;">Payment received</span>
            </td>
          </tr>
        </table>
        <h1 style="font-size:20px;color:${BRAND.dark};margin:0 0 12px;">Thank you, ${p.name}!</h1>
        <p style="font-size:14px;color:${BRAND.muted};line-height:1.6;margin:0 0 8px;">
          Your order <strong style="color:${BRAND.dark};">${p.orderNumber}</strong>${p.orderDate ? ` placed on ${p.orderDate}` : ''} is confirmed and being prepared.
        </p>
        ${itemsTable(p.items)}
        <table role="presentation" width="100%" style="margin-top:4px;">
          <tr><td style="font-size:14px;color:${BRAND.muted};padding:4px 0;">Subtotal</td><td align="right" style="font-size:14px;color:${BRAND.dark};">${currency(p.subtotal)}</td></tr>
          <tr><td style="font-size:14px;color:${BRAND.muted};padding:4px 0;">Delivery</td><td align="right" style="font-size:14px;color:${BRAND.dark};">${currency(p.shippingCost)}</td></tr>
          <tr><td style="font-size:15px;font-weight:bold;color:${BRAND.dark};padding:10px 0 0;border-top:2px solid ${BRAND.dark};">Total</td><td align="right" style="font-size:15px;font-weight:bold;color:${BRAND.dark};padding:10px 0 0;border-top:2px solid ${BRAND.dark};">${currency(p.amount)}</td></tr>
          ${p.paymentMethod ? `<tr><td style="font-size:12px;color:${BRAND.muted};padding-top:6px;">Paid via ${p.paymentMethod}</td><td></td></tr>` : ''}
        </table>
        <p style="font-size:13px;color:${BRAND.muted};margin-top:16px;">Delivering to: ${p.address}</p>

        <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};margin:28px 0 14px;padding-top:20px;border-top:1px solid #eee;">What happens next</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="width:26px;vertical-align:top;padding-bottom:16px;">
              <div style="width:20px;height:20px;border-radius:50%;background:${BRAND.gold};color:#fff;font-size:12px;font-weight:bold;text-align:center;line-height:20px;">1</div>
            </td>
            <td style="vertical-align:top;padding-bottom:16px;">
              <div style="font-size:13px;color:${BRAND.dark};font-weight:bold;">Preparing your order</div>
              <div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">We're packing your fragrance(s) now.</div>
            </td>
          </tr>
          <tr>
            <td style="width:26px;vertical-align:top;padding-bottom:16px;">
              <div style="width:20px;height:20px;border-radius:50%;border:1.5px solid #ccc;color:${BRAND.muted};font-size:12px;text-align:center;line-height:17px;">2</div>
            </td>
            <td style="vertical-align:top;padding-bottom:16px;">
              <div style="font-size:13px;color:${BRAND.dark};font-weight:bold;">Dispatched</div>
              <div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">You'll get an SMS and email with your rider's name, phone number, and estimated delivery time.</div>
            </td>
          </tr>
          <tr>
            <td style="width:26px;vertical-align:top;">
              <div style="width:20px;height:20px;border-radius:50%;border:1.5px solid #ccc;color:${BRAND.muted};font-size:12px;text-align:center;line-height:17px;">3</div>
            </td>
            <td style="vertical-align:top;">
              <div style="font-size:13px;color:${BRAND.dark};font-weight:bold;">Delivered</div>
              <div style="font-size:12px;color:${BRAND.muted};margin-top:2px;">Your rider hands it over — enjoy your fragrance!</div>
            </td>
          </tr>
        </table>
      `,
    }),
  }),
  order_shipped: (p) => ({
    subject: `Your order ${p.orderNumber} has been dispatched`,
    html: layout({
      title: 'Order Dispatched',
      preheader: `Order ${p.orderNumber} is on its way — estimated delivery ${p.eta}`,
      bodyHtml: `
        <h1 style="font-size:20px;color:${BRAND.dark};margin:0 0 12px;">On its way, ${p.name}!</h1>
        <p style="font-size:14px;color:${BRAND.muted};line-height:1.6;margin:0 0 20px;">
          Order <strong style="color:${BRAND.dark};">${p.orderNumber}</strong> has been dispatched with our rider.
        </p>
        <table role="presentation" width="100%" style="background:${BRAND.cream};border-radius:6px;margin-bottom:8px;">
          <tr>
            <td style="padding:16px;">
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};margin-bottom:6px;">Your Rider</div>
              <div style="font-size:15px;color:${BRAND.dark};font-weight:bold;">${p.riderName}</div>
              <div style="font-size:14px;color:${BRAND.muted};">${p.riderPhone}</div>
              <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:${BRAND.muted};margin-top:14px;">Estimated Delivery</div>
              <div style="font-size:14px;color:${BRAND.dark};">${p.eta}</div>
            </td>
          </tr>
        </table>
        ${itemsTable(p.items)}
        <p style="font-size:13px;color:${BRAND.muted};margin-top:16px;">Delivering to: ${p.address}. The rider will call you to arrange delivery.</p>
      `,
    }),
  }),
  order_delivered: (p) => ({
    subject: `Delivered — Order ${p.orderNumber}`,
    html: layout({
      title: 'Order Delivered',
      preheader: `Order ${p.orderNumber} has been delivered`,
      bodyHtml: `
        <h1 style="font-size:20px;color:${BRAND.dark};margin:0 0 12px;">Enjoy your fragrance, ${p.name}!</h1>
        <p style="font-size:14px;color:${BRAND.muted};line-height:1.6;">
          Your order <strong style="color:${BRAND.dark};">${p.orderNumber}</strong> has been delivered.
          Thank you for shopping with VX Perfumery — we hope to serve you again soon.
        </p>
      `,
    }),
  }),
  payment_failed: (p) => ({
    subject: `Payment issue — Order ${p.orderNumber}`,
    html: layout({
      title: 'Payment Failed',
      preheader: `We couldn't process payment for order ${p.orderNumber}`,
      bodyHtml: `
        <h1 style="font-size:20px;color:${BRAND.dark};margin:0 0 12px;">Hi ${p.name},</h1>
        <p style="font-size:14px;color:${BRAND.muted};line-height:1.6;">
          We couldn't process payment for order <strong style="color:${BRAND.dark};">${p.orderNumber}</strong>.
          Please try again from your account page.
        </p>
      `,
    }),
  }),
};

/**
 * Send a branded email via Gmail SMTP and record the attempt in NotificationLog.
 * Never throws — a failed email must not break order processing.
 */
async function sendEmail(to, messageType, params = {}) {
  const build = templates[messageType];
  if (!build || !to) return null;

  const { subject, html } = build(params);
  const log = { recipient: to, messageType, provider: 'gmail_smtp' };

  const t = await getTransporter();
  if (!t) {
    console.error(`Email not sent (${messageType} → ${to}): set EMAIL_USER and EMAIL_APP_PASSWORD in .env`);
    await NotificationLog.create({ ...log, status: 'failed', errorMessage: 'Email not configured' }).catch(() => {});
    return null;
  }

  try {
    const info = await t.sendMail({
      from: `"${BRAND.name}" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    await NotificationLog.create({ ...log, status: 'sent', externalReferenceId: info.messageId });
    return info;
  } catch (err) {
    console.error(`Email failed (${messageType} → ${to}):`, err.message);
    await NotificationLog.create({ ...log, status: 'failed', errorMessage: err.message }).catch(() => {});
    return null;
  }
}

module.exports = { sendEmail, templates };
