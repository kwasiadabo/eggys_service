const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const { requireAuth, optionalAuth, requireAdmin, requireRider, requireRiderPasswordSet } = require('../middleware/auth');
const { authLimiter, lookupLimiter } = require('../middleware/rateLimit');

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (_req, file, cb) =>
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-z0-9.\-]/gi, '_')}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) =>
    cb(file.mimetype.startsWith('image/') ? null : new Error('Only image files are allowed'), true),
});
const auth = require('../controllers/authController');
const products = require('../controllers/productController');
const cart = require('../controllers/cartController');
const favorites = require('../controllers/favoriteController');
const orders = require('../controllers/orderController');
const admin = require('../controllers/adminController');
const delivery = require('../controllers/deliveryController');
const issues = require('../controllers/issueController');
const reports = require('../controllers/reportController');

// ===================== Auth =====================

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a customer account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [firstName, lastName, email, password]
 *             properties:
 *               firstName: { type: string }
 *               lastName: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *               phoneNumber: { type: string }
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409:
 *         description: Email already registered
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/auth/register', authLimiter, auth.register);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Log in with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string, format: password }
 *     responses:
 *       200:
 *         description: Logged in
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Account suspended
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/auth/login', authLimiter, auth.login);

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get the signed-in user's profile
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/User' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/auth/me', requireAuth, auth.me);

// ===================== Catalog (public) =====================

/**
 * @openapi
 * /products:
 *   get:
 *     tags: [Catalog]
 *     summary: List active products
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches product name or description
 *       - in: query
 *         name: brand
 *         schema: { type: string }
 *         description: Brand name
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *         description: Category name
 *       - in: query
 *         name: gender
 *         schema: { type: string, enum: [male, female, unisex] }
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Paginated product list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 products: { type: array, items: { $ref: '#/components/schemas/Product' } }
 *                 total: { type: integer }
 *                 page: { type: integer }
 *                 pageSize: { type: integer }
 */
router.get('/products', products.list);

/**
 * @openapi
 * /products/recommendations:
 *   get:
 *     tags: [Catalog]
 *     summary: Anonymous product recommendations (best sellers / newest fallback)
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 8 }
 *     responses:
 *       200:
 *         description: Recommended products
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Product' } }
 */
router.get('/products/recommendations', products.recommendations); // anonymous fallback

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     tags: [Catalog]
 *     summary: Get a single active product
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Product
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/Product' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/products/:id', products.getOne);

/**
 * @openapi
 * /brands:
 *   get:
 *     tags: [Catalog]
 *     summary: List all brands
 *     responses:
 *       200:
 *         description: Brands
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Brand' } }
 */
router.get('/brands', products.listBrands);

/**
 * @openapi
 * /categories:
 *   get:
 *     tags: [Catalog]
 *     summary: List all categories
 *     responses:
 *       200:
 *         description: Categories
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Category' } }
 */
router.get('/categories', products.listCategories);

/**
 * @openapi
 * /recommendations:
 *   get:
 *     tags: [Catalog]
 *     summary: Personalized product recommendations for the signed-in user
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 8 }
 *     responses:
 *       200:
 *         description: Recommended products
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Product' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/recommendations', requireAuth, products.recommendations);

// ===================== Cart =====================

/**
 * @openapi
 * /cart:
 *   get:
 *     tags: [Cart]
 *     summary: Get the signed-in user's cart
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Cart items
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/CartItem' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   delete:
 *     tags: [Cart]
 *     summary: Clear the cart
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       204: { description: Cart cleared }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/cart', requireAuth, cart.getCart);

/**
 * @openapi
 * /cart/items:
 *   post:
 *     tags: [Cart]
 *     summary: Add a product to the cart (increments quantity if already present)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId: { type: string, format: uuid }
 *               quantity: { type: integer, default: 1 }
 *     responses:
 *       200:
 *         description: Existing cart item updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/CartItem' } } }
 *       201:
 *         description: Cart item created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/CartItem' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/cart/items', requireAuth, cart.addItem);

/**
 * @openapi
 * /cart/items/{itemId}:
 *   patch:
 *     tags: [Cart]
 *     summary: Set a cart item's quantity
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Updated cart item
 *         content: { application/json: { schema: { $ref: '#/components/schemas/CartItem' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Cart]
 *     summary: Remove a cart item
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Item removed }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/cart/items/:itemId', requireAuth, cart.updateItem);
router.delete('/cart/items/:itemId', requireAuth, cart.removeItem);
router.delete('/cart', requireAuth, cart.clearCart);

// ===================== Favorites =====================

/**
 * @openapi
 * /favorites:
 *   get:
 *     tags: [Favorites]
 *     summary: List the signed-in user's favorite products
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Favorites
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Favorite' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *   post:
 *     tags: [Favorites]
 *     summary: Add a product to favorites
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId]
 *             properties:
 *               productId: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Already favorited
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Favorite' } } }
 *       201:
 *         description: Added
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Favorite' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/favorites', requireAuth, favorites.list);
router.post('/favorites', requireAuth, favorites.add);

/**
 * @openapi
 * /favorites/{productId}:
 *   delete:
 *     tags: [Favorites]
 *     summary: Remove a product from favorites
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Removed }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/favorites/:productId', requireAuth, favorites.remove);

// ===================== Orders & payment =====================

/**
 * @openapi
 * /orders:
 *   post:
 *     tags: [Orders]
 *     summary: Check out — build an order from the cart (or, for guests, from submitted items), reserve stock, and start a Paystack payment
 *     description: >
 *       Works both signed-in (builds the order from the server-side cart) and
 *       as a guest (no auth header — pass guestName/guestEmail/guestPhone and
 *       an items array directly, since there's no account-linked cart).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address, city, region]
 *             properties:
 *               address: { type: string }
 *               street: { type: string }
 *               area: { type: string }
 *               city: { type: string }
 *               region: { type: string }
 *               shippingCost: { type: number, default: 0 }
 *               guestName: { type: string, description: Required for guest checkout }
 *               guestEmail: { type: string, description: Required for guest checkout }
 *               guestPhone: { type: string, description: Required for guest checkout }
 *               items:
 *                 type: array
 *                 description: Required for guest checkout (ignored for signed-in requests, which use the server cart)
 *                 items:
 *                   type: object
 *                   properties:
 *                     productId: { type: string, format: uuid }
 *                     quantity: { type: integer }
 *     responses:
 *       201:
 *         description: Order created; redirect the customer to paymentUrl
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 order: { $ref: '#/components/schemas/Order' }
 *                 paymentUrl: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       409:
 *         description: Insufficient stock for an item in the cart
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *   get:
 *     tags: [Orders]
 *     summary: List the signed-in user's orders
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Orders
 *         content:
 *           application/json:
 *             schema: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/orders', optionalAuth, orders.createOrder);
router.get('/orders', requireAuth, orders.listMyOrders);

/**
 * @openapi
 * /orders/lookup:
 *   get:
 *     tags: [Orders]
 *     summary: Public self-serve order tracking — for guests (no account) and signed-in customers alike
 *     description: The order number plus a matching phone/email acts as the credential, since this route has no auth.
 *     parameters:
 *       - in: query
 *         name: orderNumber
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: contact
 *         required: true
 *         schema: { type: string }
 *         description: The email or phone number used at checkout
 *     responses:
 *       200:
 *         description: Order
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/orders/lookup', lookupLimiter, orders.lookupOrder);

/**
 * @openapi
 * /orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get one of the signed-in user's orders
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/orders/:id', requireAuth, orders.getOrder);

/**
 * @openapi
 * /orders/{id}/verify:
 *   get:
 *     tags: [Orders]
 *     summary: Client-side fallback to verify payment after a Paystack redirect
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Current payment/order status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string, format: uuid }
 *                 status: { type: string }
 *                 paymentStatus: { type: string }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/orders/:id/verify', requireAuth, orders.verifyPayment);

/**
 * @openapi
 * /payments/verify:
 *   get:
 *     tags: [Orders]
 *     summary: Verify a payment by Paystack reference (called from the payment-complete page)
 *     description: Public — the reference itself is the credential, so this works for guest checkouts too.
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Current payment/order status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderNumber: { type: string }
 *                 status: { type: string }
 *                 paymentStatus: { type: string }
 *                 totalAmount: { type: number }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/payments/verify', orders.verifyByReference);

/**
 * @openapi
 * /paystack/webhook:
 *   post:
 *     tags: [Orders]
 *     summary: Paystack payment event webhook (signature-verified, no auth)
 *     description: >
 *       Called by Paystack, not by API clients. The `x-paystack-signature` header is
 *       verified against the raw request body before the event is processed.
 *     parameters:
 *       - in: header
 *         name: x-paystack-signature
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object }
 *     responses:
 *       200: { description: Acknowledged }
 *       401:
 *         description: Invalid signature
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.post('/paystack/webhook', orders.paystackWebhook); // signature-verified, no auth

// ===================== Issues (customer support) =====================

/**
 * @openapi
 * /issues:
 *   post:
 *     tags: [Issues]
 *     summary: File a support issue, optionally tied to one of the user's own orders
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, description]
 *             properties:
 *               category: { type: string, enum: [non_delivery, bad_product, wrong_item, damaged, other] }
 *               description: { type: string }
 *               orderId: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Issue created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Issue' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   get:
 *     tags: [Issues]
 *     summary: List the signed-in user's own issues
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Issues
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Issue' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/issues', requireAuth, issues.create);
router.get('/issues', requireAuth, issues.listMine);

// ===================== Delivery fees (public) =====================

/**
 * @openapi
 * /delivery-fees:
 *   get:
 *     tags: [Delivery]
 *     summary: List delivery fees by region/city (needed at checkout)
 *     responses:
 *       200:
 *         description: Delivery fees
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/DeliveryFee' } } } }
 */
router.get('/delivery-fees', delivery.listFees);

// ===================== Rider portal =====================

/**
 * @openapi
 * /rider/login:
 *   post:
 *     tags: [Rider]
 *     summary: Rider login with phone + PIN (first login) or phone + password (after setup)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [phone, credential]
 *             properties:
 *               phone: { type: string }
 *               credential:
 *                 type: string
 *                 description: SMS PIN on first login, password afterwards
 *     responses:
 *       200:
 *         description: Rider token issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 rider:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 mustSetPassword:
 *                   type: boolean
 *                   description: True if the rider must set a password before continuing
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/rider/login', authLimiter, delivery.riderLogin);

/**
 * @openapi
 * /rider/set-password:
 *   post:
 *     tags: [Rider]
 *     summary: Set a password after a first PIN login (required before using the rest of the portal)
 *     security: [{ riderAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string, format: password, minLength: 6 }
 *     responses:
 *       200:
 *         description: Password set; re-issued token without the mustSetPassword flag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token: { type: string }
 *                 rider:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/rider/set-password', requireRider, delivery.riderSetPassword);

/**
 * @openapi
 * /rider/deliveries:
 *   get:
 *     tags: [Rider]
 *     summary: List the signed-in rider's active (dispatched) deliveries
 *     security: [{ riderAuth: [] }]
 *     responses:
 *       200:
 *         description: Rider and active orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 rider:
 *                   type: object
 *                   properties:
 *                     id: { type: string, format: uuid }
 *                     name: { type: string }
 *                 orders: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Password setup still required
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/rider/deliveries', requireRider, requireRiderPasswordSet, delivery.riderDeliveries);

/**
 * @openapi
 * /rider/deliveries/{id}/confirm:
 *   post:
 *     tags: [Rider]
 *     summary: Confirm a dispatched order as delivered
 *     security: [{ riderAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Order marked delivered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string, format: uuid }
 *                 orderNumber: { type: string }
 *                 status: { type: string }
 *       400:
 *         description: Order is not in a state that can be confirmed
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Password setup still required
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/rider/deliveries/:id/confirm', requireRider, requireRiderPasswordSet, delivery.riderConfirmDelivery);

/**
 * @openapi
 * /rider/report:
 *   get:
 *     tags: [Rider]
 *     summary: The signed-in rider's own assigned + delivered orders in a date range (JSON)
 *     security: [{ riderAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         description: Defaults to 30 days ago
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         description: Defaults to today
 *     responses:
 *       200:
 *         description: Rider report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 from: { type: string, format: date-time }
 *                 to: { type: string, format: date-time }
 *                 assigned: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *                 delivered: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *                 totals:
 *                   type: object
 *                   properties:
 *                     assignedCount: { type: integer }
 *                     deliveredCount: { type: integer }
 *                     deliveredAmount: { type: number }
 *                     deliveredFees: { type: number }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Password setup still required
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 */
router.get('/rider/report', requireRider, requireRiderPasswordSet, delivery.riderReport);

/**
 * @openapi
 * /rider/report.pdf:
 *   get:
 *     tags: [Rider]
 *     summary: The signed-in rider's own report as a downloadable PDF
 *     security: [{ riderAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: PDF file
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Password setup still required
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/rider/report.pdf', requireRider, requireRiderPasswordSet, delivery.riderReportPdf);

// ===================== Admin — delivery management =====================

/**
 * @openapi
 * /admin/delivery-persons:
 *   get:
 *     tags: [Admin]
 *     summary: List delivery persons with active-delivery counts
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Delivery persons
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/DeliveryPerson' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *   post:
 *     tags: [Admin]
 *     summary: Create a delivery person (a one-time login PIN is generated and SMS'd)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phoneNumber]
 *             properties:
 *               name: { type: string }
 *               phoneNumber: { type: string }
 *     responses:
 *       201:
 *         description: Created — includes the plaintext PIN once, and whether the SMS was sent
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/DeliveryPerson'
 *                 - type: object
 *                   properties:
 *                     pin: { type: string }
 *                     smsSent: { type: boolean }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/delivery-persons', requireAdmin, delivery.listPersons);
router.post('/admin/delivery-persons', requireAdmin, delivery.createPerson);

/**
 * @openapi
 * /admin/delivery-persons/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a delivery person's name, phone or active status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phoneNumber: { type: string }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/DeliveryPerson' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/admin/delivery-persons/:id', requireAdmin, delivery.updatePerson);

/**
 * @openapi
 * /admin/delivery-persons/{id}/reset-pin:
 *   post:
 *     tags: [Admin]
 *     summary: Reset a rider's PIN and clear their password (account-recovery path)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: New PIN generated and SMS'd
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/DeliveryPerson'
 *                 - type: object
 *                   properties:
 *                     pin: { type: string }
 *                     smsSent: { type: boolean }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/admin/delivery-persons/:id/reset-pin', requireAdmin, delivery.resetPin);

/**
 * @openapi
 * /admin/delivery-persons/{id}/dispatch:
 *   post:
 *     tags: [Admin]
 *     summary: Dispatch a rider with their assigned pending-delivery orders
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderIds:
 *                 type: array
 *                 items: { type: string, format: uuid }
 *                 description: Optional subset of the rider's pending-delivery orders to dispatch
 *     responses:
 *       200:
 *         description: Dispatched
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 deliveryPersonId: { type: string, format: uuid }
 *                 dispatched:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: string, format: uuid }
 *                       orderNumber: { type: string }
 *                 smsSent: { type: boolean }
 *       400:
 *         description: Rider deactivated or has no orders awaiting dispatch
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/admin/delivery-persons/:id/dispatch', requireAdmin, delivery.dispatchRider);

/**
 * @openapi
 * /admin/orders/{id}/assign:
 *   patch:
 *     tags: [Admin]
 *     summary: Assign (or unassign) a pending-delivery order to a rider
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               deliveryPersonId:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Pass null to unassign
 *     responses:
 *       200:
 *         description: Assignment updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 orderId: { type: string, format: uuid }
 *                 deliveryPersonId: { type: string, format: uuid, nullable: true }
 *       400:
 *         description: Order is not pending-delivery, or rider deactivated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/admin/orders/:id/assign', requireAdmin, delivery.assignOrder);

/**
 * @openapi
 * /admin/delivery-fees:
 *   put:
 *     tags: [Admin]
 *     summary: Create or update the fee for a region/city
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [region, fee]
 *             properties:
 *               region: { type: string }
 *               city: { type: string, default: Other }
 *               fee: { type: number, minimum: 0 }
 *     responses:
 *       200:
 *         description: Updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/DeliveryFee' } } }
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/DeliveryFee' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.put('/admin/delivery-fees', requireAdmin, delivery.upsertFee);

/**
 * @openapi
 * /admin/delivery-fees/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete a delivery fee (the 'Other' regional fallback cannot be deleted)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Deleted }
 *       400:
 *         description: Cannot delete the 'Other' fallback fee
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/admin/delivery-fees/:id', requireAdmin, delivery.removeFee);

// ===================== Admin — image upload =====================

/**
 * @openapi
 * /admin/upload:
 *   post:
 *     tags: [Admin]
 *     summary: Upload a product image (max 5MB, image/* only)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Uploaded — url can be stored as a product's imageUrl
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string, example: /uploads/1700000000000-photo.jpg }
 *       400:
 *         description: No image file received, or invalid file type
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file received' });
  res.status(201).json({ url: `/uploads/${req.file.filename}` });
});

// ===================== Admin — catalog & orders =====================

/**
 * @openapi
 * /admin/products:
 *   post:
 *     tags: [Admin]
 *     summary: Create a product (and its inventory record)
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProductInput' }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/admin/products', requireAdmin, admin.createProduct);

/**
 * @openapi
 * /admin/products/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a product
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ProductInput' }
 *     responses:
 *       200:
 *         description: Updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Product' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Admin]
 *     summary: Soft-delete a product (deactivates it; keeps order history intact)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       204: { description: Deactivated }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/admin/products/:id', requireAdmin, admin.updateProduct);
router.delete('/admin/products/:id', requireAdmin, admin.deleteProduct);

/**
 * @openapi
 * /admin/products/{id}/restock:
 *   post:
 *     tags: [Admin]
 *     summary: Restock a product
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Updated inventory
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Inventory' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/admin/products/:id/restock', requireAdmin, admin.restockProduct);

/**
 * @openapi
 * /admin/brands:
 *   post:
 *     tags: [Admin]
 *     summary: Create a brand
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               countryOfOrigin: { type: string }
 *               description: { type: string }
 *               logoUrl: { type: string }
 *               isFeatured: { type: boolean }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Brand' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/admin/brands', requireAdmin, admin.createBrand);

/**
 * @openapi
 * /admin/categories:
 *   post:
 *     tags: [Admin]
 *     summary: Create a category
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Category' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.post('/admin/categories', requireAdmin, admin.createCategory);

/**
 * @openapi
 * /admin/orders:
 *   get:
 *     tags: [Admin]
 *     summary: List orders with optional filters
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, pending_delivery, dispatched, delivered, cancelled] }
 *       - in: query
 *         name: rider
 *         schema: { type: string }
 *         description: Delivery person id, or "unassigned"
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Orders placed on this calendar day (server-local time)
 *       - in: query
 *         name: destination
 *         schema: { type: string }
 *         description: Matches any shipping address field
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50, maximum: 200 }
 *     responses:
 *       200:
 *         description: Orders
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Order' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/orders', requireAdmin, admin.listOrders);

/**
 * @openapi
 * /admin/orders/pending-count:
 *   get:
 *     tags: [Admin]
 *     summary: Count of orders awaiting dispatch (paid, not yet assigned/delivered) — cheap poll target for the sidebar badge
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Count
 *         content: { application/json: { schema: { type: object, properties: { count: { type: integer } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/orders/pending-count', requireAdmin, admin.pendingOrdersCount);

/**
 * @openapi
 * /admin/orders/{id}/status:
 *   patch:
 *     tags: [Admin]
 *     summary: Update an order's status (triggers customer SMS for dispatched/delivered)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, pending_delivery, dispatched, delivered, cancelled] }
 *     responses:
 *       200:
 *         description: Updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Order' } } }
 *       400:
 *         description: Invalid status, or dispatching without an assigned rider
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/admin/orders/:id/status', requireAdmin, admin.updateOrderStatus);

// ===================== Admin — analytics & reports =====================

/**
 * @openapi
 * /admin/dashboard:
 *   get:
 *     tags: [Reports]
 *     summary: Aggregate KPIs for the admin dashboard (revenue, orders, customers, delivery, inventory, issues, trends)
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Dashboard metrics
 *         content: { application/json: { schema: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/dashboard', requireAdmin, admin.dashboard);

/**
 * @openapi
 * /admin/reports/sales:
 *   get:
 *     tags: [Reports]
 *     summary: Daily sales trend + totals (JSON preview of the PDF report)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *         description: Defaults to 30 days ago
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *         description: Defaults to today
 *     responses:
 *       200:
 *         description: Sales report
 *         content: { application/json: { schema: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/sales', requireAdmin, admin.salesReport);

/**
 * @openapi
 * /admin/reports/sales.pdf:
 *   get:
 *     tags: [Reports]
 *     summary: Daily sales report as a downloadable PDF
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: PDF file
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/sales.pdf', requireAdmin, admin.salesReportPdf);

/**
 * @openapi
 * /admin/reports/product-sales:
 *   get:
 *     tags: [Reports]
 *     summary: One product's daily units-sold and revenue trend
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: productId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Product sales trend
 *         content: { application/json: { schema: { type: object } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/admin/reports/product-sales', requireAdmin, admin.productSalesTrend);

/**
 * @openapi
 * /admin/reports/inventory:
 *   get:
 *     tags: [Reports]
 *     summary: Current stock levels, values and low-stock flags for all active products
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Inventory report
 *         content: { application/json: { schema: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/inventory', requireAdmin, admin.inventoryReport);

/**
 * @openapi
 * /admin/reports/orders:
 *   get:
 *     tags: [Reports]
 *     summary: All orders placed in a date range, with totals (JSON preview)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Orders report
 *         content: { application/json: { schema: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/orders', requireAdmin, reports.ordersJson);

/**
 * @openapi
 * /admin/reports/orders.pdf:
 *   get:
 *     tags: [Reports]
 *     summary: Orders report as a downloadable PDF
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: PDF file
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/orders.pdf', requireAdmin, reports.ordersPdf);

/**
 * @openapi
 * /admin/reports/rider-deliveries:
 *   get:
 *     tags: [Reports]
 *     summary: Deliveries in a date range, grouped by rider, with totals (JSON preview)
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Rider deliveries report
 *         content: { application/json: { schema: { type: object } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/rider-deliveries', requireAdmin, reports.riderDeliveriesJson);

/**
 * @openapi
 * /admin/reports/rider-deliveries.pdf:
 *   get:
 *     tags: [Reports]
 *     summary: Rider deliveries report as a downloadable PDF
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: PDF file
 *         content: { application/pdf: { schema: { type: string, format: binary } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/reports/rider-deliveries.pdf', requireAdmin, reports.riderDeliveriesPdf);

// ===================== Admin — issues =====================

/**
 * @openapi
 * /admin/issues:
 *   get:
 *     tags: [Admin]
 *     summary: List all support issues, optionally filtered by status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, in_progress, resolved] }
 *     responses:
 *       200:
 *         description: Issues
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/Issue' } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/issues', requireAdmin, issues.listAll);

/**
 * @openapi
 * /admin/issues/open-count:
 *   get:
 *     tags: [Admin]
 *     summary: Count of open (unresolved) support issues — cheap poll target for the sidebar badge
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Count
 *         content: { application/json: { schema: { type: object, properties: { count: { type: integer } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/admin/issues/open-count', requireAdmin, issues.openCount);

/**
 * @openapi
 * /admin/issues/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Respond to and/or update the status of an issue
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               response: { type: string, description: Admin response text; sets status to resolved if status is not also given }
 *               status: { type: string, enum: [open, in_progress, resolved] }
 *     responses:
 *       200:
 *         description: Updated
 *         content: { application/json: { schema: { $ref: '#/components/schemas/Issue' } } }
 *       400: { $ref: '#/components/responses/BadRequest' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/admin/issues/:id', requireAdmin, issues.respond);

module.exports = router;
