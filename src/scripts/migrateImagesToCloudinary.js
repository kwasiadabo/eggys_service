// One-off: uploads every locally-stored product image (imageUrl starting with
// /uploads/) to Cloudinary, then repoints the product at the new secure_url
// and stores the returned public_id for future cleanup.
// Usage: node src/scripts/migrateImagesToCloudinary.js
require('dotenv').config();
const path = require('path');
const { sequelize, Product } = require('../models');
const cloudinary = require('../config/cloudinary');

async function main() {
  await sequelize.authenticate();
  const products = await Product.findAll({ where: {} });
  const localProducts = products.filter((p) => p.imageUrl && p.imageUrl.startsWith('/uploads/'));

  if (localProducts.length === 0) {
    console.log('No local product images to migrate.');
    process.exit(0);
  }

  let migrated = 0;
  for (const product of localProducts) {
    const localPath = path.join(__dirname, '../../', product.imageUrl);
    try {
      const result = await cloudinary.uploader.upload(localPath, { folder: 'eggys/products' });
      await product.update({ imageUrl: result.secure_url, cloudinaryPublicId: result.public_id });
      console.log(`✓ ${product.sku}: ${product.imageUrl}`);
      migrated++;
    } catch (err) {
      console.error(`✗ ${product.sku} (${localPath}): ${err.message}`);
    }
  }

  console.log(`Migrated ${migrated}/${localProducts.length} product images.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
