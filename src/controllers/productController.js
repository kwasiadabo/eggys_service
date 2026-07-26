const { Op } = require('sequelize');
const { Product, Brand, Category, Inventory } = require('../models');
const { getRecommendationsForUser } = require('../services/recommendations');

const listInclude = [
  { model: Brand },
  { model: Category },
  { model: Inventory, attributes: ['quantityInStock'] },
];

// GET /products?search=&brand=&category=&minPrice=&maxPrice=&page=&pageSize=
async function list(req, res, next) {
  try {
    const { search, brand, category, gender, minPrice, maxPrice } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Number(req.query.pageSize) || 20);

    const where = { isActive: true };
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
      ];
    }
    if (['male', 'female', 'unisex'].includes(gender)) where.gender = gender;
    if (minPrice) where.price = { ...(where.price || {}), [Op.gte]: Number(minPrice) };
    if (maxPrice) where.price = { ...(where.price || {}), [Op.lte]: Number(maxPrice) };

    const include = [
      { model: Brand, ...(brand && { where: { name: brand } }) },
      { model: Category, ...(category && { where: { name: category } }) },
      { model: Inventory, attributes: ['quantityInStock'] },
    ];

    const { rows, count } = await Product.findAndCountAll({
      where,
      include,
      order: [['createdAt', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
      distinct: true,
    });
    res.json({ products: rows, total: count, page, pageSize });
  } catch (err) {
    next(err);
  }
}

async function getOne(req, res, next) {
  try {
    const product = await Product.findByPk(req.params.id, { include: listInclude });
    if (!product || !product.isActive) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    next(err);
  }
}

async function listBrands(_req, res, next) {
  try {
    res.json(await Brand.findAll({ order: [['name', 'ASC']] }));
  } catch (err) {
    next(err);
  }
}

async function listCategories(_req, res, next) {
  try {
    res.json(await Category.findAll({ order: [['name', 'ASC']] }));
  } catch (err) {
    next(err);
  }
}

// Works logged-in (personalized) or anonymous (best sellers/newest)
async function recommendations(req, res, next) {
  try {
    const userId = req.user?.id || null;
    res.json(await getRecommendationsForUser(userId, Number(req.query.limit) || 8));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, getOne, listBrands, listCategories, recommendations };
