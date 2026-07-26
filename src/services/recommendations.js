const { Op, fn, col, literal } = require('sequelize');
const { Product, Brand, Inventory, Favorite, Order, OrderItem } = require('../models');

const productInclude = [
  { model: Brand },
  { model: Inventory, attributes: ['quantityInStock'] },
];

/**
 * MVP recommendation strategy, in priority order:
 * 1. Products from the user's favorite brands they haven't bought yet
 * 2. Best sellers overall (fills remaining slots)
 * Phase 2 upgrades this to collaborative filtering / fragrance-note matching.
 */
async function getRecommendationsForUser(userId, limit = 8) {
  const results = [];
  const seen = new Set();

  if (userId) {
    const favorites = await Favorite.findAll({
      where: { UserId: userId },
      include: [{ model: Product, attributes: ['BrandId'] }],
    });
    const brandIds = [...new Set(favorites.map((f) => f.Product?.BrandId).filter(Boolean))];

    const purchased = await OrderItem.findAll({
      include: [{ model: Order, where: { UserId: userId }, attributes: [] }],
      attributes: ['ProductId'],
    });
    const purchasedIds = purchased.map((i) => i.ProductId);

    if (brandIds.length) {
      const brandPicks = await Product.findAll({
        where: {
          BrandId: { [Op.in]: brandIds },
          isActive: true,
          ...(purchasedIds.length && { id: { [Op.notIn]: purchasedIds } }),
        },
        include: productInclude,
        limit,
      });
      for (const p of brandPicks) {
        results.push(p);
        seen.add(p.id);
      }
    }
  }

  if (results.length < limit) {
    const bestSellerRows = await OrderItem.findAll({
      attributes: ['ProductId', [fn('SUM', col('quantity')), 'totalSold']],
      group: ['ProductId'],
      order: [[literal('totalSold'), 'DESC']],
      limit: limit * 2,
      raw: true,
    });
    const ids = bestSellerRows.map((r) => r.ProductId).filter((pid) => !seen.has(pid));
    const bestSellers = await Product.findAll({
      where: { id: { [Op.in]: ids }, isActive: true },
      include: productInclude,
    });
    for (const p of bestSellers) {
      if (results.length >= limit) break;
      results.push(p);
      seen.add(p.id);
    }
  }

  if (results.length < limit) {
    const newest = await Product.findAll({
      where: { isActive: true, id: { [Op.notIn]: [...seen] } },
      include: productInclude,
      order: [['createdAt', 'DESC']],
      limit: limit - results.length,
    });
    results.push(...newest);
  }

  return results.slice(0, limit);
}

module.exports = { getRecommendationsForUser };
