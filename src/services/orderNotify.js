// Shared helpers for building order-notification (SMS + email) payloads across
// the payment-confirm, admin-dispatch, and rider-portal flows — all three need
// the same guest-vs-registered-user fallback and delivery-window estimate.

const GREATER_ACCRA_WINDOW = '2-5 hours';
const OTHER_REGIONS_WINDOW = 'within 24 hours';

/** Greater Accra deliveries run same-day; everywhere else in Ghana is next-day. */
function estimateDeliveryWindow(region) {
  const normalized = String(region || '').trim().toLowerCase();
  return normalized === 'greater accra' ? GREATER_ACCRA_WINDOW : OTHER_REGIONS_WINDOW;
}

/** Registered users have a User association; guest checkouts fall back to the guest* fields on the order. */
function orderRecipient(order) {
  return {
    phone: order.User?.phoneNumber || order.guestPhone,
    name: order.User?.firstName || order.guestName,
    email: order.User?.email || order.guestEmail,
  };
}

/** Structured line items (for the email table); requires the order to have been loaded with OrderItem+Product included. */
function getOrderItems(order) {
  return (order.OrderItems || []).map((oi) => ({
    name: oi.Product?.name || 'item',
    quantity: oi.quantity,
    unitPrice: Number(oi.unitPrice),
    subtotal: Number(oi.subtotal),
  }));
}

/** One-line "2x Product A, 1x Product B" summary for SMS. */
function formatOrderItems(order) {
  return getOrderItems(order).map((i) => `${i.quantity}x ${i.name}`).join(', ');
}

/** Rider + ETA + items, shared by every "order dispatched" notification (SMS and email need slightly different item shapes). */
function dispatchDetails(order, rider) {
  return {
    itemsText: formatOrderItems(order),
    items: getOrderItems(order),
    riderName: rider?.name,
    riderPhone: rider?.phoneNumber,
    eta: estimateDeliveryWindow(order.shippingRegion),
  };
}

module.exports = {
  estimateDeliveryWindow,
  orderRecipient,
  getOrderItems,
  formatOrderItems,
  dispatchDetails,
};
