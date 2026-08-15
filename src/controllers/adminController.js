const { Op, fn, col, literal } = require('sequelize');
const { sequelize, Product, Brand, Category, Inventory, InventoryLog, Order, OrderItem, User, OrderStatusHistory, DeliveryPerson, Issue } = require('../models');
const cloudinary = require('../config/cloudinary');
const { sendSms } = require('../services/naloSms');
const { sendEmail } = require('../services/email');
const { buildSalesReport } = require('../services/pdfReports');
const { orderRecipient, dispatchDetails } = require('../services/orderNotify');

// ---------- Products ----------

async function createProduct(req, res, next) {
  const t = await sequelize.transaction();
  try {
    const { quantityInStock = 0, reorderLevel = 5, brandId, categoryId, ...fields } = req.body;
    const product = await Product.create({ ...fields, BrandId: brandId, CategoryId: categoryId }, { transaction: t });
    await Inventory.create({
      ProductId: product.id,
      quantityInStock,
      reorderLevel,
      lastRestockedAt: quantityInStock > 0 ? new Date() : null,
    }, { transaction: t });
    if (quantityInStock > 0) {
      await InventoryLog.create({
        ProductId: product.id, action: 'restocked', quantityChange: quantityInStock,
      }, { transaction: t });
    }
    await t.commit();
    res.status(201).json(await Product.findByPk(product.id, { include: [Brand, Category, Inventory] }));
  } catch (err) {
    if (!t.finished) await t.rollback();
    next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { brandId, categoryId, ...fields } = req.body;
    const oldPublicId = product.cloudinaryPublicId;
    await product.update({ ...fields, ...(brandId && { BrandId: brandId }), ...(categoryId && { CategoryId: categoryId }) });
    // Image was replaced (not just re-saved) — drop the old Cloudinary asset so it
    // doesn't linger as orphaned storage.
    if (fields.cloudinaryPublicId && oldPublicId && oldPublicId !== fields.cloudinaryPublicId) {
      cloudinary.uploader.destroy(oldPublicId).catch((err) => console.error('Cloudinary cleanup failed:', err.message));
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
}

// Soft delete — keeps order history intact
async function deleteProduct(req, res, next) {
  try {
    const product = await Product.findByPk(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    await product.update({ isActive: false });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

// ---------- Users ----------

const USER_ATTRS = ['id', 'firstName', 'lastName', 'email', 'phoneNumber', 'isAdmin', 'accountStatus', 'createdAt'];

async function listUsers(req, res, next) {
  try {
    const { search, status } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

    const where = {};
    if (search) {
      where[Op.or] = [
        { firstName: { [Op.like]: `%${search}%` } },
        { lastName: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }
    if (['active', 'suspended'].includes(status)) where.accountStatus = status;

    const { rows, count } = await User.findAndCountAll({
      where,
      attributes: USER_ATTRS,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ users: rows, total: count, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await User.findByPk(req.params.id, { attributes: USER_ATTRS });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { firstName, lastName, phoneNumber } = req.body;
    await user.update({
      ...(firstName !== undefined && { firstName }),
      ...(lastName !== undefined && { lastName }),
      ...(phoneNumber !== undefined && { phoneNumber }),
    });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

// Suspending blocks login (authController.login) and immediately invalidates any
// existing session (requireAuth re-checks accountStatus on every request), rather
// than just waiting out the 7-day token expiry.
async function setUserStatus(req, res, next) {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own account status' });
    }
    const user = await User.findByPk(req.params.id, { attributes: USER_ATTRS });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await user.update({ accountStatus: status });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function restockProduct(req, res, next) {
  try {
    const quantity = Number(req.body.quantity);
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'quantity must be a positive number' });
    const inventory = await Inventory.findOne({ where: { ProductId: req.params.id } });
    if (!inventory) return res.status(404).json({ error: 'Inventory record not found' });
    inventory.quantityInStock += quantity;
    inventory.lastRestockedAt = new Date();
    await inventory.save();
    await InventoryLog.create({ ProductId: req.params.id, action: 'restocked', quantityChange: quantity });
    res.json(inventory);
  } catch (err) {
    next(err);
  }
}

async function createBrand(req, res, next) {
  try {
    res.status(201).json(await Brand.create(req.body));
  } catch (err) {
    next(err);
  }
}

async function createCategory(req, res, next) {
  try {
    res.status(201).json(await Category.create(req.body));
  } catch (err) {
    next(err);
  }
}

// ---------- Orders ----------

async function listOrders(req, res, next) {
  try {
    const where = {};
    // 'active' is a sentinel (not a real status) meaning "everything still in
    // the fulfillment pipeline" — used by the admin Orders page's Current tab
    // so it doesn't need to know/enumerate every non-delivered status value.
    if (req.query.status === 'active') where.status = { [Op.ne]: 'delivered' };
    else if (req.query.status) where.status = req.query.status;
    if (req.query.rider === 'unassigned') where.DeliveryPersonId = null;
    else if (req.query.rider) where.DeliveryPersonId = req.query.rider;
    // orders placed within a date range (YYYY-MM-DD, server-local time, both ends inclusive)
    if (req.query.dateFrom || req.query.dateTo) {
      const range = {};
      let hasRange = false;
      if (req.query.dateFrom) {
        const from = new Date(`${req.query.dateFrom}T00:00:00`);
        if (!Number.isNaN(from.getTime())) {
          range[Op.gte] = from;
          hasRange = true;
        }
      }
      if (req.query.dateTo) {
        const to = new Date(`${req.query.dateTo}T00:00:00`);
        if (!Number.isNaN(to.getTime())) {
          to.setDate(to.getDate() + 1);
          range[Op.lt] = to;
          hasRange = true;
        }
      }
      if (hasRange) where.createdAt = range;
    }
    if (req.query.destination) {
      const term = `%${req.query.destination}%`;
      // Resolve matching customers to ids first rather than filtering on
      // `$User.column$` directly — combined with the OrderItem hasMany
      // include below and `limit`, an include-column condition in the
      // top-level where can make Sequelize build a subquery that never
      // joins User at all, silently dropping the filter (or erroring on MSSQL).
      const matchingUsers = await User.findAll({
        where: {
          [Op.or]: [
            { firstName: { [Op.like]: term } },
            { lastName: { [Op.like]: term } },
            { phoneNumber: { [Op.like]: term } },
            { email: { [Op.like]: term } },
          ],
        },
        attributes: ['id'],
      });
      where[Op.or] = [
        { shippingAddress: { [Op.like]: term } },
        { shippingStreet: { [Op.like]: term } },
        { shippingArea: { [Op.like]: term } },
        { shippingCity: { [Op.like]: term } },
        { shippingRegion: { [Op.like]: term } },
        { orderNumber: { [Op.like]: term } },
        { guestName: { [Op.like]: term } },
        { guestPhone: { [Op.like]: term } },
        { guestEmail: { [Op.like]: term } },
        ...(matchingUsers.length ? [{ UserId: { [Op.in]: matchingUsers.map((u) => u.id) } }] : []),
      ];
    }
    const orders = await Order.findAll({
      where,
      include: [
        { model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] },
        { model: OrderItem, include: [Product] },
        { model: DeliveryPerson, attributes: ['id', 'name', 'phoneNumber'] },
      ],
      order: [['createdAt', 'DESC']],
      limit: Math.min(200, Number(req.query.limit) || 50),
    });
    res.json(orders);
  } catch (err) {
    next(err);
  }
}

/** GET /admin/orders/pending-count — cheap poll target for the admin sidebar badge/alert. */
async function pendingOrdersCount(_req, res, next) {
  try {
    const count = await Order.count({ where: { status: 'pending_delivery' } });
    res.json({ count });
  } catch (err) {
    next(err);
  }
}

const SMS_BY_STATUS = { dispatched: 'order_shipped', delivered: 'order_delivered' };

async function updateOrderStatus(req, res, next) {
  try {
    const { status } = req.body;
    const allowed = ['pending', 'pending_delivery', 'dispatched', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

    const order = await Order.findByPk(req.params.id, {
      include: [
        { model: User, attributes: ['firstName', 'lastName', 'email', 'phoneNumber'] },
        { model: DeliveryPerson, attributes: ['id', 'name', 'phoneNumber'] },
        { model: OrderItem, include: [Product] },
      ],
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (status === 'dispatched' && !order.DeliveryPersonId) {
      return res.status(400).json({ error: 'Assign a rider before dispatching this order' });
    }

    order.status = status;
    if (status === 'dispatched') order.dispatchedAt = new Date();
    if (status === 'delivered') order.deliveredAt = new Date();
    await order.save();

    const history = await OrderStatusHistory.create({ OrderId: order.id, status });
    const { phone, name, email } = orderRecipient(order);
    if (SMS_BY_STATUS[status] && (phone || email)) {
      const d = status === 'dispatched' ? dispatchDetails(order, order.DeliveryPerson) : null;
      const smsExtra = d ? { items: d.itemsText, riderName: d.riderName, riderPhone: d.riderPhone, eta: d.eta } : {};
      const emailExtra = d ? { items: d.items, riderName: d.riderName, riderPhone: d.riderPhone, eta: d.eta, address: order.shippingAddress } : {};
      const smsResult = phone && await sendSms(phone, SMS_BY_STATUS[status], {
        name,
        orderNumber: order.orderNumber,
        ...smsExtra,
      });
      const emailResult = email && await sendEmail(email, SMS_BY_STATUS[status], {
        name,
        orderNumber: order.orderNumber,
        ...emailExtra,
      });
      if (smsResult || emailResult) {
        history.smsSentAt = new Date();
        await history.save();
      }
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
}

// ---------- Analytics & reports ----------

// last N calendar days (local), oldest first — used to zero-fill days with no orders
function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function dashboard(_req, res, next) {
  try {
    const paidWhere = { paymentStatus: 'completed' };
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const trendStart = new Date();
    trendStart.setHours(0, 0, 0, 0);
    trendStart.setDate(trendStart.getDate() - 29);

    const [
      totalRevenue, totalProductRevenue, totalDeliveryRevenue, totalOrders,
      todayRevenue, todayOrders,
      monthRevenue, monthOrders,
      totalCustomers, newCustomers,
      lowStock, outOfStock, activeProducts,
      activeRiders, deliveredThisMonth,
      openIssues, issuesThisMonth,
      statusCounts,
    ] = await Promise.all([
      Order.sum('totalAmount', { where: paidWhere }),
      Order.sum('subtotal', { where: paidWhere }),
      Order.sum('shippingCost', { where: paidWhere }),
      Order.count({ where: paidWhere }),
      Order.sum('totalAmount', { where: { ...paidWhere, createdAt: { [Op.gte]: startOfToday } } }),
      Order.count({ where: { ...paidWhere, createdAt: { [Op.gte]: startOfToday } } }),
      Order.sum('totalAmount', { where: { ...paidWhere, createdAt: { [Op.gte]: startOfMonth } } }),
      Order.count({ where: { ...paidWhere, createdAt: { [Op.gte]: startOfMonth } } }),
      User.count({ where: { isAdmin: false } }),
      User.count({ where: { isAdmin: false, createdAt: { [Op.gte]: startOfMonth } } }),
      Inventory.count({ where: { quantityInStock: { [Op.lte]: col('reorderLevel') } } }),
      Inventory.count({ where: { quantityInStock: 0 } }),
      Product.count({ where: { isActive: true } }),
      DeliveryPerson.count({ where: { isActive: true } }),
      Order.count({ where: { status: 'delivered', deliveredAt: { [Op.gte]: startOfMonth } } }),
      Issue.count({ where: { status: 'open' } }),
      Issue.count({ where: { createdAt: { [Op.gte]: startOfMonth } } }),
      Order.findAll({
        attributes: ['status', [fn('COUNT', col('id')), 'count']],
        group: ['status'],
        raw: true,
      }),
    ]);

    const byStatus = { pending: 0, pending_delivery: 0, dispatched: 0, delivered: 0, cancelled: 0 };
    for (const row of statusCounts) byStatus[row.status] = Number(row.count);

    // Raw SQL: Sequelize's grouped-include-with-limit combination generates invalid T-SQL
    const [topProducts] = await sequelize.query(`
      SELECT TOP 5 oi.ProductId, p.name, p.sku,
             SUM(oi.quantity) AS unitsSold, SUM(oi.subtotal) AS revenue
      FROM OrderItems oi
      JOIN Products p ON p.id = oi.ProductId
      GROUP BY oi.ProductId, p.name, p.sku
      ORDER BY SUM(oi.quantity) DESC
    `);

    const [topBrands] = await sequelize.query(`
      SELECT TOP 5 b.id AS brandId, b.name,
             SUM(oi.subtotal) AS revenue, SUM(oi.quantity) AS unitsSold
      FROM OrderItems oi
      JOIN Products p ON p.id = oi.ProductId
      JOIN Brands b ON b.id = p.BrandId
      GROUP BY b.id, b.name
      ORDER BY SUM(oi.subtotal) DESC
    `);

    const [[profitRow]] = await sequelize.query(`
      SELECT SUM((oi.unitPrice - ISNULL(p.costPrice, p.price)) * oi.quantity) AS grossProfit
      FROM OrderItems oi
      JOIN Orders o ON o.id = oi.OrderId AND o.paymentStatus = 'completed'
      JOIN Products p ON p.id = oi.ProductId
    `);

    const [[deliveryTimeRow]] = await sequelize.query(`
      SELECT AVG(CAST(DATEDIFF(minute, createdAt, deliveredAt) AS FLOAT)) / 60.0 AS avgHours
      FROM Orders WHERE status = 'delivered' AND deliveredAt IS NOT NULL
    `);

    const [[repeatRow]] = await sequelize.query(`
      SELECT
        COUNT(*) AS customersWithOrders,
        SUM(CASE WHEN orderCount >= 2 THEN 1 ELSE 0 END) AS repeatCustomers
      FROM (SELECT UserId, COUNT(*) AS orderCount FROM Orders GROUP BY UserId) t
    `);

    const [trendRows] = await sequelize.query(`
      SELECT CONVERT(date, createdAt) AS day, COUNT(*) AS orders, SUM(totalAmount) AS revenue
      FROM Orders
      WHERE paymentStatus = 'completed' AND createdAt >= :trendStart
      GROUP BY CONVERT(date, createdAt)
      ORDER BY CONVERT(date, createdAt) ASC
    `, { replacements: { trendStart } });
    const trendByDay = new Map(trendRows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
    const revenueTrend = lastNDays(30).map((day) => ({
      day,
      revenue: Number(trendByDay.get(day)?.revenue) || 0,
      orders: Number(trendByDay.get(day)?.orders) || 0,
    }));

    const grossProfit = Number(profitRow?.grossProfit) || 0;
    const customersWithOrders = Number(repeatRow?.customersWithOrders) || 0;
    const repeatCustomers = Number(repeatRow?.repeatCustomers) || 0;

    res.json({
      revenue: {
        total: Number(totalRevenue) || 0,
        today: Number(todayRevenue) || 0,
        month: Number(monthRevenue) || 0,
        totalProduct: Number(totalProductRevenue) || 0,
        totalDelivery: Number(totalDeliveryRevenue) || 0,
        averageOrderValue: totalOrders ? Number(totalRevenue) / totalOrders : 0,
        grossProfit,
        profitMarginPct: totalProductRevenue ? (grossProfit / Number(totalProductRevenue)) * 100 : 0,
      },
      orders: {
        total: totalOrders,
        today: todayOrders,
        month: monthOrders,
        byStatus,
      },
      customers: {
        total: totalCustomers,
        newThisMonth: newCustomers,
        repeatRate: customersWithOrders ? (repeatCustomers / customersWithOrders) * 100 : 0,
      },
      delivery: {
        activeRiders,
        awaitingDispatch: byStatus.pending_delivery,
        outForDelivery: byStatus.dispatched,
        deliveredThisMonth,
        avgDeliveryHours: Number(deliveryTimeRow?.avgHours) || 0,
      },
      inventory: {
        activeProducts,
        lowStockCount: lowStock,
        outOfStockCount: outOfStock,
      },
      issues: {
        open: openIssues,
        thisMonth: issuesThisMonth,
      },
      revenueTrend,
      topProducts,
      topBrands,
    });
  } catch (err) {
    next(err);
  }
}

// every calendar day between from and to (inclusive), oldest first — zero-fills days with no sales
function eachDay(from, to) {
  const days = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

async function fetchSalesTrend({ from, to }) {
  const where = { paymentStatus: 'completed', createdAt: { [Op.between]: [from, to] } };
  const rows = await Order.findAll({
    attributes: [
      [fn('CONVERT', literal('date'), col('createdAt')), 'day'],
      [fn('COUNT', col('id')), 'orders'],
      [fn('SUM', col('totalAmount')), 'revenue'],
    ],
    where,
    group: [fn('CONVERT', literal('date'), col('createdAt'))],
    raw: true,
  });
  const byDay = new Map(rows.map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
  const daily = eachDay(from, to).map((day) => ({
    day,
    orders: Number(byDay.get(day)?.orders) || 0,
    revenue: Number(byDay.get(day)?.revenue) || 0,
  }));
  const totals = {
    days: daily.length,
    totalOrders: daily.reduce((sum, d) => sum + d.orders, 0),
    totalRevenue: daily.reduce((sum, d) => sum + d.revenue, 0),
  };
  totals.averageDailyRevenue = totals.days ? totals.totalRevenue / totals.days : 0;
  totals.averageOrderValue = totals.totalOrders ? totals.totalRevenue / totals.totalOrders : 0;
  return { daily, totals };
}

// GET /admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD — daily sales + trend (JSON preview)
async function salesReport(req, res, next) {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const { daily, totals } = await fetchSalesTrend({ from, to });
    res.json({ from, to, daily, totals });
  } catch (err) {
    next(err);
  }
}

// GET /admin/reports/sales.pdf?from=&to= — same report, as a downloadable PDF
async function salesReportPdf(req, res, next) {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const { daily, totals } = await fetchSalesTrend({ from, to });
    const doc = buildSalesReport({ from, to, daily, totals });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report-${req.query.from || 'last30'}-${req.query.to || 'now'}.pdf"`);
    doc.pipe(res);
    doc.end();
  } catch (err) {
    next(err);
  }
}

// GET /admin/reports/product-sales?productId=&from=&to= — one product's daily units sold + revenue trend
async function productSalesTrend(req, res, next) {
  try {
    const { productId } = req.query;
    if (!productId) return res.status(400).json({ error: 'productId is required' });
    const product = await Product.findByPk(productId, { attributes: ['id', 'name', 'sku'], include: [{ model: Brand, attributes: ['name'] }] });
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();

    // Raw SQL: Sequelize's grouped-include-with-limit combination generates invalid T-SQL
    const rows = await sequelize.query(`
      SELECT CONVERT(date, o.createdAt) AS day,
             SUM(oi.quantity) AS unitsSold, SUM(oi.subtotal) AS revenue
      FROM OrderItems oi
      JOIN Orders o ON o.id = oi.OrderId
      WHERE oi.ProductId = :productId
        AND o.paymentStatus = 'completed'
        AND o.createdAt BETWEEN :from AND :to
      GROUP BY CONVERT(date, o.createdAt)
    `, { replacements: { productId, from, to } });

    const byDay = new Map(rows[0].map((r) => [new Date(r.day).toISOString().slice(0, 10), r]));
    const daily = eachDay(from, to).map((day) => ({
      day,
      unitsSold: Number(byDay.get(day)?.unitsSold) || 0,
      revenue: Number(byDay.get(day)?.revenue) || 0,
    }));
    const totals = {
      days: daily.length,
      totalUnitsSold: daily.reduce((sum, d) => sum + d.unitsSold, 0),
      totalRevenue: daily.reduce((sum, d) => sum + d.revenue, 0),
    };

    res.json({ from, to, product, daily, totals });
  } catch (err) {
    next(err);
  }
}

async function inventoryReport(_req, res, next) {
  try {
    const stock = await Inventory.findAll({
      include: [{ model: Product, where: { isActive: true }, include: [Brand], attributes: ['name', 'sku', 'price', 'costPrice'] }],
      order: [['quantityInStock', 'ASC']],
    });
    const report = stock.map((row) => ({
      product: row.Product.name,
      sku: row.Product.sku,
      brand: row.Product.Brand?.name,
      quantityInStock: row.quantityInStock,
      reorderLevel: row.reorderLevel,
      lowStock: row.quantityInStock <= row.reorderLevel,
      stockValue: row.quantityInStock * Number(row.Product.costPrice || row.Product.price),
      lastRestockedAt: row.lastRestockedAt,
    }));
    res.json({
      totalStockValue: report.reduce((sum, r) => sum + r.stockValue, 0),
      lowStockItems: report.filter((r) => r.lowStock).length,
      items: report,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createProduct, updateProduct, deleteProduct, restockProduct,
  createBrand, createCategory,
  listUsers, updateUser, setUserStatus,
  listOrders, updateOrderStatus, pendingOrdersCount,
  dashboard, salesReport, salesReportPdf, productSalesTrend, inventoryReport,
};
