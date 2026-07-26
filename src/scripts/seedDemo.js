// Seeds demo brands, categories, products, and sample orders so the store
// and admin pages have data to display. Safe to re-run (skips if data exists).
// Usage: node src/scripts/seedDemo.js
require('dotenv').config();
const { sequelize, User, Brand, Category, Product, Inventory, Order, OrderItem, OrderStatusHistory } = require('../models');

async function seed() {
  await sequelize.authenticate();

  if (await Product.count() > 0) {
    console.log('Products already exist — skipping seed.');
    process.exit(0);
  }

  const [sunrise, goldenAcres, meadowFresh] = await Promise.all([
    Brand.create({ name: 'Sunrise Farms', countryOfOrigin: 'Ghana', isFeatured: true }),
    Brand.create({ name: 'Golden Acres', countryOfOrigin: 'Ghana', isFeatured: true }),
    Brand.create({ name: 'Meadow Fresh Farms', countryOfOrigin: 'Ghana' }),
  ]);

  const [chickenEggs, organicRange, duckEggs] = await Promise.all([
    Category.create({ name: 'Chicken Eggs' }),
    Category.create({ name: 'Organic Range' }),
    Category.create({ name: 'Duck Eggs' }),
  ]);

  const productDefs = [
    { sku: 'SUNR-FREERANGE-12', name: 'Free-Range Chicken Eggs (12-pack)', BrandId: sunrise.id, CategoryId: chickenEggs.id, price: 28, costPrice: 18, packSize: 12, eggType: 'chicken', gradeSize: 'large', farmingMethod: 'free_range', description: 'Free-range chicken eggs, graded large, from small Ghanaian farms.', stock: 24 },
    { sku: 'GOLD-ORGANIC-12', name: 'Organic Chicken Eggs (12-pack)', BrandId: goldenAcres.id, CategoryId: organicRange.id, price: 34, costPrice: 22, packSize: 12, eggType: 'chicken', gradeSize: 'large', farmingMethod: 'organic', description: 'Certified organic chicken eggs, graded large.', stock: 15 },
    { sku: 'MEAD-JUMBODUCK-6', name: 'Jumbo Duck Eggs (6-pack)', BrandId: meadowFresh.id, CategoryId: duckEggs.id, price: 26, costPrice: 17, packSize: 6, eggType: 'duck', gradeSize: 'jumbo', farmingMethod: 'free_range', description: 'Jumbo free-range duck eggs, rich and full-flavored.', stock: 8 },
    { sku: 'SUNR-JUMBO-30', name: 'Jumbo Chicken Eggs (30-pack)', BrandId: sunrise.id, CategoryId: chickenEggs.id, price: 62, costPrice: 40, packSize: 30, eggType: 'chicken', gradeSize: 'jumbo', farmingMethod: 'free_range', description: 'Bulk crate of jumbo free-range chicken eggs.', stock: 4 },
  ];

  const products = [];
  for (const def of productDefs) {
    const { stock, ...fields } = def;
    const product = await Product.create(fields);
    await Inventory.create({ ProductId: product.id, quantityInStock: stock, reorderLevel: 5, lastRestockedAt: new Date() });
    products.push(product);
  }

  // Demo customer + orders in various statuses
  const bcrypt = require('bcryptjs');
  const customer = await User.create({
    firstName: 'Ama', lastName: 'Mensah', email: 'ama.demo@example.com',
    passwordHash: await bcrypt.hash('Demo#2026', 12), phoneNumber: '233240000000',
  });

  const orderDefs = [
    { status: 'delivered', paymentStatus: 'completed', items: [[0, 1]], daysAgo: 12 },
    { status: 'dispatched', paymentStatus: 'completed', items: [[2, 1], [1, 1]], daysAgo: 3 },
    { status: 'pending_delivery', paymentStatus: 'completed', items: [[3, 1]], daysAgo: 1 },
    { status: 'pending', paymentStatus: 'pending', items: [[0, 2]], daysAgo: 0 },
  ];

  for (const [i, def] of orderDefs.entries()) {
    const createdAt = new Date(Date.now() - def.daysAgo * 24 * 3600 * 1000);
    const subtotal = def.items.reduce((sum, [pi, qty]) => sum + Number(products[pi].price) * qty, 0);
    const order = await Order.create({
      orderNumber: `EGG-DEMO-${1001 + i}`,
      UserId: customer.id,
      status: def.status,
      paymentStatus: def.paymentStatus,
      subtotal,
      shippingCost: 20,
      totalAmount: subtotal + 20,
      paystackReference: `EGG-DEMO-${1001 + i}`,
      shippingAddress: '12 Osu Oxford Street, Accra',
      deliveredAt: def.status === 'delivered' ? createdAt : null,
      createdAt,
    });
    for (const [pi, qty] of def.items) {
      await OrderItem.create({
        OrderId: order.id, ProductId: products[pi].id,
        quantity: qty, unitPrice: products[pi].price,
        subtotal: Number(products[pi].price) * qty,
      });
    }
    await OrderStatusHistory.create({ OrderId: order.id, status: def.status });
  }

  console.log('✓ Seeded 3 brands, 4 products, 1 demo customer, 4 orders (delivered/dispatched/pending_delivery/pending)');
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
