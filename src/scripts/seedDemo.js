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

  const [dior, tomFord, creed] = await Promise.all([
    Brand.create({ name: 'Dior', countryOfOrigin: 'France', isFeatured: true }),
    Brand.create({ name: 'Tom Ford', countryOfOrigin: 'USA', isFeatured: true }),
    Brand.create({ name: 'Creed', countryOfOrigin: 'France' }),
  ]);

  const [floral, woody, fresh] = await Promise.all([
    Category.create({ name: 'Floral' }),
    Category.create({ name: 'Woody' }),
    Category.create({ name: 'Fresh' }),
  ]);

  const productDefs = [
    { sku: 'DIOR-SAUV-100', name: 'Sauvage Eau de Parfum', BrandId: dior.id, CategoryId: fresh.id, price: 1450, costPrice: 980, volumeMl: 100, fragranceType: 'eau_de_parfum', topNotes: 'Bergamot', heartNotes: 'Lavender, Pepper', baseNotes: 'Ambroxan, Vanilla', description: 'A radically fresh composition with a powerful woody trail.', stock: 24 },
    { sku: 'DIOR-JADORE-50', name: "J'adore Eau de Parfum", BrandId: dior.id, CategoryId: floral.id, price: 1280, costPrice: 850, volumeMl: 50, fragranceType: 'eau_de_parfum', topNotes: 'Ylang-Ylang', heartNotes: 'Damascus Rose', baseNotes: 'Jasmine Sambac', description: 'The iconic floral bouquet, luminous and sensual.', stock: 15 },
    { sku: 'TF-OUDWOOD-50', name: 'Oud Wood', BrandId: tomFord.id, CategoryId: woody.id, price: 2650, costPrice: 1900, volumeMl: 50, fragranceType: 'eau_de_parfum', topNotes: 'Rare Oud, Rosewood', heartNotes: 'Cardamom, Sandalwood', baseNotes: 'Tonka Bean, Amber', description: 'Exotic rare oud wood — smoky, sophisticated, addictive.', stock: 8 },
    { sku: 'CREED-AVENTUS-100', name: 'Aventus', BrandId: creed.id, CategoryId: fresh.id, price: 3900, costPrice: 2800, volumeMl: 100, fragranceType: 'eau_de_parfum', topNotes: 'Pineapple, Bergamot', heartNotes: 'Birch, Patchouli', baseNotes: 'Musk, Oakmoss', description: 'The legendary scent of strength and success.', stock: 4 },
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
    { status: 'shipped', paymentStatus: 'completed', items: [[2, 1], [1, 1]], daysAgo: 3 },
    { status: 'paid', paymentStatus: 'completed', items: [[3, 1]], daysAgo: 1 },
    { status: 'pending', paymentStatus: 'pending', items: [[0, 2]], daysAgo: 0 },
  ];

  for (const [i, def] of orderDefs.entries()) {
    const createdAt = new Date(Date.now() - def.daysAgo * 24 * 3600 * 1000);
    const subtotal = def.items.reduce((sum, [pi, qty]) => sum + Number(products[pi].price) * qty, 0);
    const order = await Order.create({
      orderNumber: `VX-DEMO-${1001 + i}`,
      UserId: customer.id,
      status: def.status,
      paymentStatus: def.paymentStatus,
      subtotal,
      shippingCost: 20,
      totalAmount: subtotal + 20,
      paystackReference: `VX-DEMO-${1001 + i}`,
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

  console.log('✓ Seeded 3 brands, 4 products, 1 demo customer, 4 orders (delivered/shipped/paid/pending)');
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
