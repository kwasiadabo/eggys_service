// Clears the catalog and reloads it with ~18 egg products, each using a
// deterministic placeholder product photo (downloaded from Picsum by seed —
// swap for real farm/carton photography whenever it's available).
// Usage: node src/scripts/seedCatalog.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize, Brand, Category, Product, Inventory, CartItem, Favorite, OrderItem, InventoryLog } = require('../models');

// [producer, name, eggType, packSize, price, category, gradeSize, farmingMethod]
const CATALOG = [
  ['Sunrise Farms', 'Free-Range Chicken Eggs (12-pack)', 'chicken', 12, 28, 'Chicken Eggs', 'large', 'free_range'],
  ['Sunrise Farms', 'Jumbo Chicken Eggs (30-pack)', 'chicken', 30, 62, 'Chicken Eggs', 'jumbo', 'free_range'],
  ['Golden Acres', 'Organic Chicken Eggs (12-pack)', 'chicken', 12, 34, 'Organic Range', 'large', 'organic'],
  ['Golden Acres', 'Organic Chicken Eggs (6-pack)', 'chicken', 6, 19, 'Organic Range', 'medium', 'organic'],
  ['Green Valley Farms', 'Pasture-Raised Chicken Eggs (12-pack)', 'chicken', 12, 32, 'Chicken Eggs', 'extra_large', 'pasture_raised'],
  ['Green Valley Farms', 'Chicken Eggs (30-pack)', 'chicken', 30, 55, 'Chicken Eggs', 'medium', 'caged'],
  ['Happy Hen Farms', 'Small Chicken Eggs (15-pack)', 'chicken', 15, 22, 'Chicken Eggs', 'small', 'free_range'],
  ['Happy Hen Farms', 'Extra-Large Chicken Eggs (12-pack)', 'chicken', 12, 30, 'Chicken Eggs', 'extra_large', 'free_range'],
  ['Meadow Fresh Farms', 'Jumbo Duck Eggs (6-pack)', 'duck', 6, 26, 'Duck Eggs', 'jumbo', 'free_range'],
  ['Meadow Fresh Farms', 'Duck Eggs (12-pack)', 'duck', 12, 48, 'Duck Eggs', 'large', 'pasture_raised'],
  ['Village Poultry Co.', 'Organic Duck Eggs (6-pack)', 'duck', 6, 30, 'Organic Range', 'large', 'organic'],
  ['Coastal Egg Co.', 'Quail Eggs (30-pack)', 'quail', 30, 24, 'Quail Eggs', 'small', 'free_range'],
  ['Coastal Egg Co.', 'Quail Eggs (15-pack)', 'quail', 15, 14, 'Quail Eggs', 'small', 'caged'],
  ['Highland Farms', 'Guinea Fowl Eggs (12-pack)', 'guinea_fowl', 12, 40, 'Free-Range Selection', 'medium', 'free_range'],
  ['Highland Farms', 'Turkey Eggs (6-pack)', 'turkey', 6, 45, 'Free-Range Selection', 'extra_large', 'pasture_raised'],
  ['Riverside Poultry', 'Chicken Eggs (30-pack)', 'chicken', 30, 50, 'Chicken Eggs', 'large', 'caged'],
  ["Kofi's Poultry", 'Free-Range Chicken Eggs (6-pack)', 'chicken', 6, 16, 'Chicken Eggs', 'medium', 'free_range'],
  ["Kofi's Poultry", 'Organic Duck Eggs (12-pack)', 'duck', 12, 56, 'Organic Range', 'jumbo', 'organic'],
];

const EGG_TYPE_LABELS = { chicken: 'chicken', duck: 'duck', quail: 'quail', guinea_fowl: 'guinea fowl', turkey: 'turkey' };
const FARMING_LABELS = {
  free_range: 'free-range',
  organic: 'organically farmed',
  caged: 'conventionally farmed',
  pasture_raised: 'pasture-raised',
};

function hash(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
}

function skuFor(producer, name) {
  const abbr = (s) => s.replace(/[^a-z0-9 ]/gi, '').split(' ').map((w) => w.slice(0, 4)).join('').toUpperCase();
  return `${abbr(producer).slice(0, 6)}-${abbr(name).slice(0, 12)}`;
}

// Deterministic per-product placeholder photo — swap for real farm/carton photography later.
async function downloadPhoto(seed, destPath) {
  const res = await fetch(`https://picsum.photos/seed/${encodeURIComponent(seed)}/1000`);
  if (!res.ok) throw new Error(`Failed to download photo for seed "${seed}": ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
}

async function clearCatalog(dir) {
  await OrderItem.destroy({ where: {} });
  await CartItem.destroy({ where: {} });
  await Favorite.destroy({ where: {} });
  await InventoryLog.destroy({ where: {} });
  await Inventory.destroy({ where: {} });
  await Product.destroy({ where: {} });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function seed() {
  await sequelize.authenticate();
  const dir = path.join(__dirname, '../../uploads/catalog');
  await clearCatalog(dir);

  let created = 0;
  for (const [producerName, name, eggType, packSize, price, categoryName, gradeSize, farmingMethod] of CATALOG) {
    const sku = skuFor(producerName, name);
    const [brand] = await Brand.findOrCreate({ where: { name: producerName } });
    const [category] = await Category.findOrCreate({ where: { name: categoryName } });

    const seedNum = hash(producerName + name);
    const file = `${sku.toLowerCase()}.jpg`;
    await downloadPhoto(sku, path.join(dir, file));

    const product = await Product.create({
      sku,
      name,
      description: `${name} from ${producerName} — ${FARMING_LABELS[farmingMethod]} ${EGG_TYPE_LABELS[eggType]} eggs, graded ${gradeSize.replace(/_/g, ' ')}.`,
      price,
      costPrice: Math.round(price * 0.65),
      packSize,
      eggType,
      gradeSize,
      farmingMethod,
      imageUrl: `/uploads/catalog/${file}`,
      BrandId: brand.id,
      CategoryId: category.id,
    });
    await Inventory.create({
      ProductId: product.id,
      quantityInStock: 5 + (seedNum % 35),
      reorderLevel: 5,
      lastRestockedAt: new Date(),
    });
    created++;
  }

  const brandIds = (await Product.findAll({ attributes: ['BrandId'], group: ['BrandId'] })).map((p) => p.BrandId);
  const categoryIds = (await Product.findAll({ attributes: ['CategoryId'], group: ['CategoryId'] })).map((p) => p.CategoryId);
  await Brand.destroy({ where: { id: { [Op.notIn]: brandIds } } });
  await Category.destroy({ where: { id: { [Op.notIn]: categoryIds } } });

  console.log(`✓ catalog cleared and reseeded: ${created} products created`);
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
