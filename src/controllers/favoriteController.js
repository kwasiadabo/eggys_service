const { Favorite, Product, Brand, Inventory } = require('../models');

async function list(req, res, next) {
  try {
    const favorites = await Favorite.findAll({
      where: { UserId: req.user.id },
      include: [{ model: Product, include: [Brand, { model: Inventory, attributes: ['quantityInStock'] }] }],
      order: [['createdAt', 'DESC']],
    });
    res.json(favorites);
  } catch (err) {
    next(err);
  }
}

async function add(req, res, next) {
  try {
    const { productId } = req.body;
    const product = await Product.findByPk(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const [favorite, created] = await Favorite.findOrCreate({
      where: { UserId: req.user.id, ProductId: productId },
    });
    res.status(created ? 201 : 200).json(favorite);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const deleted = await Favorite.destroy({
      where: { UserId: req.user.id, ProductId: req.params.productId },
    });
    if (!deleted) return res.status(404).json({ error: 'Favorite not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, add, remove };
