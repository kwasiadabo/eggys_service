const { CartItem, Product, Brand, Inventory } = require('../models');

const cartInclude = [{ model: Product, include: [Brand, { model: Inventory, attributes: ['quantityInStock'] }] }];

async function getCart(req, res, next) {
  try {
    const items = await CartItem.findAll({ where: { UserId: req.user.id }, include: cartInclude });
    res.json(items);
  } catch (err) {
    next(err);
  }
}

async function addItem(req, res, next) {
  try {
    const { productId, quantity = 1 } = req.body;
    const product = await Product.findByPk(productId);
    if (!product || !product.isActive) return res.status(404).json({ error: 'Product not found' });

    const [item, created] = await CartItem.findOrCreate({
      where: { UserId: req.user.id, ProductId: productId },
      defaults: { quantity },
    });
    if (!created) {
      item.quantity += Number(quantity);
      await item.save();
    }
    res.status(created ? 201 : 200).json(item);
  } catch (err) {
    next(err);
  }
}

async function updateItem(req, res, next) {
  try {
    const item = await CartItem.findOne({ where: { id: req.params.itemId, UserId: req.user.id } });
    if (!item) return res.status(404).json({ error: 'Cart item not found' });
    const quantity = Number(req.body.quantity);
    if (!quantity || quantity < 1) return res.status(400).json({ error: 'quantity must be at least 1' });
    item.quantity = quantity;
    await item.save();
    res.json(item);
  } catch (err) {
    next(err);
  }
}

async function removeItem(req, res, next) {
  try {
    const deleted = await CartItem.destroy({ where: { id: req.params.itemId, UserId: req.user.id } });
    if (!deleted) return res.status(404).json({ error: 'Cart item not found' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

async function clearCart(req, res, next) {
  try {
    await CartItem.destroy({ where: { UserId: req.user.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
