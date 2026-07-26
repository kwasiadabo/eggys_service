const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Factory functions — Sequelize mutates attribute option objects during model
// definition, so each attribute must get its own fresh object.
const id = () => ({ type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true });
const money = () => ({ type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 });

// ---------- Core entities ----------

const User = sequelize.define('User', {
  id: id(),
  firstName: { type: DataTypes.STRING, allowNull: false },
  lastName: { type: DataTypes.STRING, allowNull: false },
  email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
  passwordHash: { type: DataTypes.STRING, allowNull: false },
  phoneNumber: { type: DataTypes.STRING },
  isAdmin: { type: DataTypes.BOOLEAN, defaultValue: false },
  accountStatus: { type: DataTypes.STRING, defaultValue: 'active' }, // active | suspended
});

const Brand = sequelize.define('Brand', {
  id: id(),
  name: { type: DataTypes.STRING, allowNull: false, unique: true },
  countryOfOrigin: { type: DataTypes.STRING },
  description: { type: DataTypes.TEXT },
  logoUrl: { type: DataTypes.STRING },
  isFeatured: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Category = sequelize.define('Category', {
  id: id(),
  name: { type: DataTypes.STRING, allowNull: false, unique: true }, // Fresh, Floral, Oriental, Woody...
  description: { type: DataTypes.TEXT },
});

const Product = sequelize.define('Product', {
  id: id(),
  sku: { type: DataTypes.STRING, allowNull: false, unique: true },
  name: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT },
  price: money(),
  costPrice: { type: DataTypes.DECIMAL(10, 2) }, // for profit analytics (admin only)
  volumeMl: { type: DataTypes.INTEGER }, // 30, 50, 100...
  fragranceType: { type: DataTypes.STRING }, // eau_de_parfum | eau_de_toilette | parfum | cologne
  gender: { type: DataTypes.STRING, defaultValue: 'unisex' }, // male | female | unisex
  topNotes: { type: DataTypes.STRING },
  heartNotes: { type: DataTypes.STRING },
  baseNotes: { type: DataTypes.STRING },
  imageUrl: { type: DataTypes.STRING },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const Inventory = sequelize.define('Inventory', {
  id: id(),
  quantityInStock: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  reorderLevel: { type: DataTypes.INTEGER, defaultValue: 5 }, // low-stock alert threshold
  lastRestockedAt: { type: DataTypes.DATE },
});

// ---------- Shopping ----------

const CartItem = sequelize.define('CartItem', {
  id: id(),
  quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
}, {
  indexes: [{ unique: true, fields: ['UserId', 'ProductId'] }],
});

const Favorite = sequelize.define('Favorite', {
  id: id(),
}, {
  indexes: [{ unique: true, fields: ['UserId', 'ProductId'] }],
});

const Address = sequelize.define('Address', {
  id: id(),
  streetAddress: { type: DataTypes.STRING, allowNull: false },
  city: { type: DataTypes.STRING, allowNull: false },
  region: { type: DataTypes.STRING },
  country: { type: DataTypes.STRING, defaultValue: 'Ghana' },
  isDefault: { type: DataTypes.BOOLEAN, defaultValue: false },
});

// ---------- Orders & payments ----------

const Order = sequelize.define('Order', {
  id: id(),
  orderNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
  status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending | paid | shipped | delivered | cancelled
  subtotal: money(),
  shippingCost: money(),
  totalAmount: money(),
  paymentStatus: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending | completed | failed
  paystackReference: { type: DataTypes.STRING, unique: true },
  shippingAddress: { type: DataTypes.STRING }, // full combined address (display/search)
  shippingStreet: { type: DataTypes.STRING },
  shippingArea: { type: DataTypes.STRING }, // area / locality within the city
  shippingCity: { type: DataTypes.STRING },
  shippingRegion: { type: DataTypes.STRING },
  deliveredAt: { type: DataTypes.DATE },
  // Set only for guest checkouts (UserId is null); a signed-in order's contact
  // info lives on the linked User instead.
  guestName: { type: DataTypes.STRING },
  guestEmail: { type: DataTypes.STRING },
  guestPhone: { type: DataTypes.STRING },
});

const OrderItem = sequelize.define('OrderItem', {
  id: id(),
  quantity: { type: DataTypes.INTEGER, allowNull: false },
  unitPrice: money(),
  subtotal: money(),
});

const Payment = sequelize.define('Payment', {
  id: id(),
  amount: money(),
  currency: { type: DataTypes.STRING, defaultValue: 'GHS' },
  method: { type: DataTypes.STRING }, // card | mobile_money | bank
  paystackReference: { type: DataTypes.STRING },
  status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending | success | failed
  errorMessage: { type: DataTypes.STRING },
});

// ---------- Delivery ----------

const DeliveryPerson = sequelize.define('DeliveryPerson', {
  id: id(),
  name: { type: DataTypes.STRING, allowNull: false },
  phoneNumber: { type: DataTypes.STRING, allowNull: false },
  pinHash: { type: DataTypes.STRING }, // hashed one-time login PIN (sent to rider by SMS)
  passwordHash: { type: DataTypes.STRING }, // set by the rider after their first PIN login; required for all logins after that
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
});

const DeliveryFee = sequelize.define('DeliveryFee', {
  id: id(),
  region: { type: DataTypes.STRING, allowNull: false },
  city: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Other' }, // 'Other' = region fallback fee
  fee: money(),
}, {
  indexes: [{ unique: true, fields: ['region', 'city'] }],
});

// ---------- Support ----------

const Issue = sequelize.define('Issue', {
  id: id(),
  category: { type: DataTypes.STRING, allowNull: false }, // non_delivery | bad_product | wrong_item | damaged | other
  description: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING, defaultValue: 'open' }, // open | in_progress | resolved
  adminResponse: { type: DataTypes.TEXT },
  respondedAt: { type: DataTypes.DATE },
});

// ---------- Audit / logs ----------

const OrderStatusHistory = sequelize.define('OrderStatusHistory', {
  id: id(),
  status: { type: DataTypes.STRING, allowNull: false },
  smsSentAt: { type: DataTypes.DATE },
});

const InventoryLog = sequelize.define('InventoryLog', {
  id: id(),
  action: { type: DataTypes.STRING, allowNull: false }, // restocked | sold | adjusted
  quantityChange: { type: DataTypes.INTEGER, allowNull: false },
  referenceId: { type: DataTypes.STRING }, // order id or manual note
});

const NotificationLog = sequelize.define('NotificationLog', {
  id: id(),
  recipient: { type: DataTypes.STRING, allowNull: false },
  messageType: { type: DataTypes.STRING, allowNull: false }, // order_confirmed | order_shipped | ...
  provider: { type: DataTypes.STRING, defaultValue: 'nalo_sms' },
  status: { type: DataTypes.STRING, defaultValue: 'sent' }, // sent | failed
  externalReferenceId: { type: DataTypes.STRING },
  errorMessage: { type: DataTypes.STRING },
});

// ---------- Associations ----------

Brand.hasMany(Product);
Product.belongsTo(Brand);

Category.hasMany(Product);
Product.belongsTo(Category);

Product.hasOne(Inventory);
Inventory.belongsTo(Product);

User.hasMany(CartItem);
CartItem.belongsTo(User);
Product.hasMany(CartItem);
CartItem.belongsTo(Product);

User.hasMany(Favorite);
Favorite.belongsTo(User);
Product.hasMany(Favorite);
Favorite.belongsTo(Product);

User.hasMany(Address);
Address.belongsTo(User);

User.hasMany(Order);
Order.belongsTo(User, { foreignKey: { allowNull: true } }); // null UserId = guest checkout
Order.hasMany(OrderItem);
OrderItem.belongsTo(Order);
Product.hasMany(OrderItem);
OrderItem.belongsTo(Product);

Order.hasMany(Payment);
Payment.belongsTo(Order);

Order.hasMany(OrderStatusHistory);
OrderStatusHistory.belongsTo(Order);

Product.hasMany(InventoryLog);
InventoryLog.belongsTo(Product);

DeliveryPerson.hasMany(Order);
Order.belongsTo(DeliveryPerson);

User.hasMany(Issue);
Issue.belongsTo(User);
Order.hasMany(Issue);
Issue.belongsTo(Order);

module.exports = {
  sequelize,
  User, Brand, Category, Product, Inventory,
  CartItem, Favorite, Address,
  Order, OrderItem, Payment,
  DeliveryPerson, DeliveryFee,
  OrderStatusHistory, InventoryLog, NotificationLog,
  Issue,
};
