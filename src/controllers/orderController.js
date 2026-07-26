const { sequelize, Order, OrderItem, Payment, Product, Brand, Inventory, CartItem, User, OrderStatusHistory, InventoryLog } = require('../models');
const paystack = require('../services/paystack');
const { sendSms } = require('../services/naloSms');
const { sendEmail } = require('../services/email');
const { orderRecipient, getOrderItems } = require('../services/orderNotify');

function generateOrderNumber() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VX-${stamp}-${rand}`;
}

/**
 * POST /orders — builds an order from the user's cart, reserves stock,
 * and returns a Paystack authorization_url to complete payment.
 */
async function createOrder(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { address, street, area, city, region, shippingCost = 0 } = req.body;
    if (!address || !city || !region) {
      await t.rollback();
      return res.status(400).json({ error: 'address, city and region are required' });
    }
    const shippingAddress = [address, street, area, city, region].filter(Boolean).join(', ');

    let user = null;
    let guestFields = {};
    let cartItems;

    if (req.user) {
      user = await User.findByPk(req.user.id);
      cartItems = await CartItem.findAll({
        where: { UserId: user.id },
        include: [{ model: Product, include: [Inventory] }],
        transaction: t,
      });
      if (!cartItems.length) {
        await t.rollback();
        return res.status(400).json({ error: 'Cart is empty' });
      }
    } else {
      // Guest checkout — no server-side cart to build from; the client sends its
      // local cart items directly, plus contact info in place of an account.
      const { guestName, guestEmail, guestPhone, items } = req.body;
      if (!guestName || !guestEmail || !guestPhone) {
        await t.rollback();
        return res.status(400).json({ error: 'guestName, guestEmail and guestPhone are required to check out as a guest' });
      }
      guestFields = { guestName, guestEmail, guestPhone };

      // Consolidate by product first — a client could (accidentally or not) send
      // the same product as separate line items, which would otherwise let each
      // one pass the per-item stock check below even though the combined
      // quantity exceeds what's in stock.
      const quantityByProduct = new Map();
      for (const item of Array.isArray(items) ? items : []) {
        const quantity = Number(item?.quantity) || 0;
        if (!item?.productId || quantity < 1) continue;
        quantityByProduct.set(item.productId, (quantityByProduct.get(item.productId) || 0) + quantity);
      }
      if (!quantityByProduct.size) {
        await t.rollback();
        return res.status(400).json({ error: 'Cart is empty' });
      }

      const products = await Product.findAll({
        where: { id: [...quantityByProduct.keys()], isActive: true },
        include: [Inventory],
        transaction: t,
      });
      const productById = new Map(products.map((p) => [p.id, p]));

      cartItems = [...quantityByProduct.entries()].map(([productId, quantity]) => ({
        ProductId: productId,
        quantity,
        Product: productById.get(productId),
      }));
      const unavailable = cartItems.find((item) => !item.Product);
      if (unavailable) {
        await t.rollback();
        return res.status(409).json({ error: 'One or more items in your cart are no longer available' });
      }
    }

    // Check + reserve stock inside the transaction to prevent overselling
    for (const item of cartItems) {
      const inv = item.Product.Inventory;
      if (!inv || inv.quantityInStock < item.quantity) {
        await t.rollback();
        return res.status(409).json({ error: `Insufficient stock for ${item.Product.name}` });
      }
    }

    const subtotal = cartItems.reduce((sum, i) => sum + Number(i.Product.price) * i.quantity, 0);
    const totalAmount = subtotal + Number(shippingCost);
    const orderNumber = generateOrderNumber();

    const order = await Order.create({
      orderNumber,
      UserId: user?.id ?? null,
      ...guestFields,
      subtotal,
      shippingCost,
      totalAmount,
      shippingAddress,
      shippingStreet: street || '',
      shippingArea: area || '',
      shippingCity: city,
      shippingRegion: region,
      paystackReference: orderNumber,
    }, { transaction: t });

    for (const item of cartItems) {
      await OrderItem.create({
        OrderId: order.id,
        ProductId: item.ProductId,
        quantity: item.quantity,
        unitPrice: item.Product.price,
        subtotal: Number(item.Product.price) * item.quantity,
      }, { transaction: t });

      const inv = item.Product.Inventory;
      inv.quantityInStock -= item.quantity;
      await inv.save({ transaction: t });
      await InventoryLog.create({
        ProductId: item.ProductId,
        action: 'sold',
        quantityChange: -item.quantity,
        referenceId: order.id,
      }, { transaction: t });
    }

    await OrderStatusHistory.create({ OrderId: order.id, status: 'pending' }, { transaction: t });
    if (user) await CartItem.destroy({ where: { UserId: user.id }, transaction: t });
    await t.commit();

    const payment = await paystack.initializeTransaction({
      email: user ? user.email : guestFields.guestEmail,
      amount: totalAmount,
      reference: orderNumber,
      metadata: { orderId: order.id, orderNumber },
    });

    res.status(201).json({ order, paymentUrl: payment.authorization_url });
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
}

/**
 * Marks an order paid, records the Payment, and sends the order-confirmed SMS.
 * Shared by the webhook and the client-triggered verify path below — whichever
 * of the two reaches a given order first (the webhook can lag the browser's
 * own redirect-triggered verify by several seconds) is the one that fires this,
 * so the confirmation always goes out exactly once instead of only when the
 * webhook happens to win the race.
 */
async function markOrderPaidAndNotify(order, verified) {
  order.status = 'pending_delivery';
  order.paymentStatus = 'completed';
  await order.save();
  await Payment.findOrCreate({
    where: { paystackReference: order.paystackReference, status: 'success' },
    defaults: {
      OrderId: order.id,
      amount: verified.amount / 100,
      currency: verified.currency,
      method: verified.channel,
    },
  });
  const history = await OrderStatusHistory.create({ OrderId: order.id, status: 'pending_delivery' });
  const { phone, name, email } = orderRecipient(order);

  // Fire notifications in the background — SMS/email providers can take
  // seconds (or, on a bad connection, their full timeout) to respond, and
  // this function is awaited directly from the client-facing verify endpoint,
  // so blocking on them here was what made payment confirmation feel slow.
  Promise.all([
    phone && sendSms(phone, 'order_confirmed', {
      name,
      orderNumber: order.orderNumber,
      amount: Number(order.totalAmount).toFixed(2),
    }),
    email && sendEmail(email, 'order_confirmed', {
      name,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      paymentMethod: verified.channel ? verified.channel.replace(/_/g, ' ') : undefined,
      amount: Number(order.totalAmount).toFixed(2),
      subtotal: Number(order.subtotal).toFixed(2),
      shippingCost: Number(order.shippingCost).toFixed(2),
      address: order.shippingAddress,
      items: getOrderItems(order),
    }),
  ]).then(([smsResult, emailResult]) => {
    if (smsResult || emailResult) {
      history.smsSentAt = new Date();
      return history.save();
    }
  }).catch((err) => console.error('order_confirmed notification error:', err.message));
}

/**
 * POST /paystack/webhook — Paystack calls this on payment events.
 * Signature is verified against the raw request body.
 */
async function paystackWebhook(req, res) {
  const signature = req.headers['x-paystack-signature'];
  if (!paystack.isValidWebhookSignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.sendStatus(200); // ack immediately; process after

  const event = req.body;
  try {
    if (event.event === 'charge.success') {
      const reference = event.data.reference;
      const order = await Order.findOne({
        where: { paystackReference: reference },
        include: [User, { model: OrderItem, include: [Product] }],
      });
      if (!order || order.paymentStatus === 'completed') return;

      // Double-check with Paystack before marking paid
      const verified = await paystack.verifyTransaction(reference);
      if (verified.status !== 'success') return;

      await markOrderPaidAndNotify(order, verified);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
}

/**
 * GET /payments/verify?reference=... — called by the payment-complete page
 * after Paystack redirects back. Public: the Paystack reference itself (an
 * unguessable, single-use value only known to the browser that just paid,
 * plus Paystack/admin) is the credential here, since a guest checkout has no
 * account to authenticate against. Verifies with Paystack and updates the order.
 */
async function verifyByReference(req, res, next) {
  try {
    const { reference } = req.query;
    if (!reference) return res.status(400).json({ error: 'reference is required' });
    const order = await Order.findOne({
      where: { paystackReference: reference },
      include: [User, { model: OrderItem, include: [Product] }],
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (order.paymentStatus !== 'completed') {
      try {
        const verified = await paystack.verifyTransaction(reference);
        if (verified.status === 'success') {
          await markOrderPaidAndNotify(order, verified);
        }
      } catch (err) {
        console.error('verifyByReference error:', err);
      }
    }
    res.json({
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /orders/:id/verify — client-side fallback after Paystack redirect. */
async function verifyPayment(req, res, next) {
  try {
    const order = await Order.findOne({ where: { id: req.params.id, UserId: req.user.id } });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.paymentStatus !== 'completed') {
      const verified = await paystack.verifyTransaction(order.paystackReference);
      if (verified.status === 'success') {
        order.status = 'pending_delivery';
        order.paymentStatus = 'completed';
        await order.save();
      }
    }
    res.json({ orderId: order.id, status: order.status, paymentStatus: order.paymentStatus });
  } catch (err) {
    next(err);
  }
}

const orderInclude = [{ model: OrderItem, include: [{ model: Product, include: [Brand] }] }];

async function listMyOrders(req, res, next) {
  try {
    const orders = await Order.findAll({
      where: { UserId: req.user.id },
      include: orderInclude,
      order: [['createdAt', 'DESC']],
    });
    res.json(orders);
  } catch (err) {
    next(err);
  }
}

async function getOrder(req, res, next) {
  try {
    const order = await Order.findOne({
      where: { id: req.params.id, UserId: req.user.id },
      include: orderInclude,
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /orders/lookup?orderNumber=&contact=  — public self-serve tracking, for
 * guests (no account to sign into) and signed-in customers alike. The order
 * number plus a matching phone/email acts as the two-factor "credential"
 * since there's no auth on this route.
 */
async function lookupOrder(req, res, next) {
  try {
    const orderNumber = req.query.orderNumber?.trim();
    const contact = req.query.contact?.trim();
    if (!orderNumber || !contact) {
      return res.status(400).json({ error: 'orderNumber and contact are required' });
    }

    const order = await Order.findOne({
      where: { orderNumber },
      include: [{ model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] }, ...orderInclude],
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const candidates = [order.User?.email, order.User?.phoneNumber, order.guestEmail, order.guestPhone]
      .filter(Boolean);
    const contactLower = contact.toLowerCase();
    const contactDigits = contact.replace(/\D/g, '').slice(-9);
    const matches = candidates.some((c) => {
      if (c.toLowerCase() === contactLower) return true;
      const digits = c.replace(/\D/g, '').slice(-9);
      return contactDigits.length >= 7 && digits === contactDigits;
    });
    if (!matches) return res.status(404).json({ error: 'Order not found' });

    res.json(order);
  } catch (err) {
    next(err);
  }
}

module.exports = { createOrder, paystackWebhook, verifyPayment, verifyByReference, listMyOrders, getOrder, lookupOrder };
