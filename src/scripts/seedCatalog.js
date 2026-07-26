// Clears the catalog and reloads it with 20 perfumes, each using a real
// high-quality product photo (downloaded from Unsplash) instead of generated art.
// Usage: node src/scripts/seedCatalog.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { sequelize, Brand, Category, Product, Inventory, CartItem, Favorite, OrderItem, InventoryLog } = require('../models');

// [brand, name, type, ml, price, category, topNotes, heartNotes, baseNotes, photoUrl]
const CATALOG = [
  ['Dior', 'Sauvage Eau de Toilette', 'eau_de_toilette', 100, 1250, 'Fresh', 'Calabrian Bergamot', 'Sichuan Pepper, Lavender', 'Ambroxan, Cedar', 'https://images.unsplash.com/photo-1644958307902-2d0347086a38'],
  ['Chanel', 'Bleu de Chanel', 'eau_de_parfum', 100, 1850, 'Aromatic', 'Grapefruit, Lemon', 'Ginger, Nutmeg', 'Sandalwood, Cedar', 'https://images.unsplash.com/photo-1523293182086-7651a899d37f'],
  ['Chanel', 'Chanel No 5', 'eau_de_parfum', 100, 2100, 'Floral', 'Aldehydes, Ylang-Ylang', 'Jasmine, Rose', 'Sandalwood, Vanilla', 'https://images.unsplash.com/photo-1541643600914-78b084683601'],
  ['Chanel', 'Coco Mademoiselle', 'eau_de_parfum', 100, 1950, 'Oriental', 'Orange, Bergamot', 'Jasmine, Rose', 'Patchouli, Vanilla', 'https://images.unsplash.com/photo-1640975972263-1f73398e943b'],
  ['Prada', 'Luna Rossa Carbon', 'eau_de_toilette', 100, 1500, 'Aromatic', 'Bergamot, Pepper', 'Lavender, Metallic Notes', 'Ambroxan, Patchouli', 'https://images.unsplash.com/photo-1610461888750-10bfc601b874'],
  ['Versace', 'Eros', 'eau_de_toilette', 100, 1150, 'Aromatic', 'Mint, Green Apple', 'Tonka Bean, Geranium', 'Vanilla, Cedar', 'https://images.unsplash.com/photo-1587017539504-67cfbddac569'],
  ['Givenchy', 'Gentleman', 'eau_de_parfum', 100, 1500, 'Woody', 'Pear, Cardamom', 'Iris, Lavender', 'Black Vanilla, Leather', 'https://images.unsplash.com/photo-1780943004195-3bd30f748872'],
  ['Hermes', 'H24', 'eau_de_toilette', 100, 1600, 'Aromatic', 'Clary Sage', 'Narcissus', 'Rosewood, Sclarene', 'https://images.unsplash.com/photo-1763631403216-8d193008481e'],
  ['Giorgio Armani', 'Acqua di Gio Profumo', 'eau_de_parfum', 75, 1600, 'Fresh', 'Sea Notes, Bergamot', 'Rosemary, Sage', 'Incense, Patchouli', 'https://images.unsplash.com/photo-1547887537-6158d64c35b3'],
  ['Yves Saint Laurent', 'Y Eau de Parfum', 'eau_de_parfum', 100, 1550, 'Aromatic', 'Apple, Ginger', 'Sage, Juniper Berries', 'Amberwood, Tonka', 'https://images.unsplash.com/photo-1674318881563-84ba1a53d9c4'],
  ['Hugo Boss', 'Boss Bottled', 'eau_de_toilette', 100, 1100, 'Woody', 'Apple, Plum', 'Cinnamon, Geranium', 'Sandalwood, Vetiver', 'https://images.unsplash.com/photo-1680084932244-bceef13873a7'],
  ['Calvin Klein', 'CK One', 'eau_de_toilette', 200, 950, 'Citrus', 'Lemon, Bergamot', 'Green Tea, Nutmeg', 'Musk, Amber', 'https://images.unsplash.com/photo-1597317628840-d3472f7aa7fc'],
  ['Mont Blanc', 'Legend', 'eau_de_toilette', 100, 900, 'Aromatic', 'Bergamot, Lavender', 'Oakmoss, Geranium', 'Tonka, Sandalwood', 'https://images.unsplash.com/photo-1638295916768-459f6cf440bc'],
  ['Burberry', 'Brit for Him', 'eau_de_toilette', 100, 1100, 'Oriental', 'Bergamot, Cardamom', 'Cedar, Nutmeg', 'Tonka, Grey Musk', 'https://images.unsplash.com/photo-1720423514789-15a33e59fc81'],
  ['Jean Paul Gaultier', 'Le Male', 'eau_de_toilette', 125, 1300, 'Aromatic', 'Mint, Lavender', 'Orange Blossom, Cinnamon', 'Vanilla, Tonka', 'https://images.unsplash.com/photo-1765306163629-c7f4dfb2ff41'],
  ['Dolce & Gabbana', 'Light Blue', 'eau_de_toilette', 100, 1350, 'Citrus', 'Sicilian Lemon, Apple', 'Jasmine, Bamboo', 'Cedar, Amber', 'https://images.unsplash.com/photo-1608721279136-cd41b752fa41'],
  ['Azzaro', 'Wanted', 'eau_de_toilette', 100, 1200, 'Citrus', 'Lemon, Ginger', 'Juniper, Cardamom', 'Tonka Bean, Amberwood', 'https://images.unsplash.com/photo-1571206508927-2ef3026ada5d'],
  ['Paco Rabanne', '1 Million', 'eau_de_toilette', 100, 1200, 'Oriental', 'Grapefruit, Mint', 'Cinnamon, Rose', 'Leather, Amber', 'https://images.unsplash.com/photo-1633072437275-ec3344b4b966'],
  ['Armaf', 'Club de Nuit Intense Man', 'eau_de_toilette', 105, 600, 'Fresh', 'Lemon, Pineapple', 'Birch, Jasmine', 'Musk, Ambergris', 'https://images.unsplash.com/photo-1769625310883-6c87ed402d6f'],
  ['Lattafa', 'Khamrah', 'eau_de_parfum', 100, 550, 'Gourmand', 'Cinnamon, Nutmeg', 'Dates, Praline', 'Vanilla, Tonka', 'https://images.unsplash.com/photo-1754826789042-00d2c8d7da80'],
];

function hash(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return h;
}

function skuFor(brand, name) {
  const abbr = (s) => s.replace(/[^a-z0-9 ]/gi, '').split(' ').map((w) => w.slice(0, 4)).join('').toUpperCase();
  return `${abbr(brand).slice(0, 6)}-${abbr(name).slice(0, 12)}`;
}

async function downloadPhoto(url, destPath) {
  const res = await fetch(`${url}?w=1000&q=85&fm=jpg&fit=crop`);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
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
  for (const [brandName, name, type, ml, price, categoryName, top, heart, base, photoUrl] of CATALOG) {
    const sku = skuFor(brandName, name);
    const [brand] = await Brand.findOrCreate({ where: { name: brandName } });
    const [category] = await Category.findOrCreate({ where: { name: categoryName } });

    const seedNum = hash(brandName + name);
    const file = `${sku.toLowerCase()}.jpg`;
    await downloadPhoto(photoUrl, path.join(dir, file));

    const product = await Product.create({
      sku,
      name,
      description: `${name} by ${brandName} — a ${categoryName.toLowerCase()} ${type.replace(/_/g, ' ')} opening with ${top.toLowerCase()}, unfolding over ${heart.toLowerCase()}, and settling into ${base.toLowerCase()}.`,
      price,
      costPrice: Math.round(price * 0.65),
      volumeMl: ml,
      fragranceType: type,
      topNotes: top,
      heartNotes: heart,
      baseNotes: base,
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
