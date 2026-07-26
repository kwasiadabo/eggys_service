const swaggerJsdoc = require('swagger-jsdoc');

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'VX Perfumery API',
    version: '0.1.0',
    description:
      'REST API for the VX Perfumery e-commerce platform — catalog browsing, cart/favorites, ' +
      'checkout with Paystack, order tracking, rider/delivery management, customer support ' +
      'issues, and admin analytics/reporting.',
  },
  servers: [
    { url: '/api', description: 'Current host, /api prefix' },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, login and the current session' },
    { name: 'Catalog', description: 'Public product, brand and category browsing' },
    { name: 'Cart', description: "The signed-in user's shopping cart" },
    { name: 'Favorites', description: "The signed-in user's saved products" },
    { name: 'Orders', description: 'Checkout, order history and payment verification' },
    { name: 'Issues', description: 'Customer support tickets' },
    { name: 'Delivery', description: 'Delivery fees (public)' },
    { name: 'Rider', description: 'Rider portal — phone/PIN login and delivery confirmation' },
    { name: 'Admin', description: 'Admin-only catalog, order and delivery management' },
    { name: 'Reports', description: 'Admin-only analytics and downloadable PDF reports' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Customer/admin token from /auth/login or /auth/register. Send as `Authorization: Bearer <token>`.',
      },
      riderAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Rider token from /rider/login. Send as `Authorization: Bearer <token>`.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          phoneNumber: { type: 'string' },
          isAdmin: { type: 'boolean' },
        },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      Brand: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          countryOfOrigin: { type: 'string' },
          description: { type: 'string' },
          logoUrl: { type: 'string' },
          isFeatured: { type: 'boolean' },
        },
      },
      Category: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
      Inventory: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          quantityInStock: { type: 'integer' },
          reorderLevel: { type: 'integer' },
          lastRestockedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Product: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          sku: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number', format: 'decimal' },
          costPrice: { type: 'number', format: 'decimal', nullable: true },
          volumeMl: { type: 'integer', nullable: true },
          fragranceType: {
            type: 'string',
            enum: ['eau_de_parfum', 'eau_de_toilette', 'parfum', 'cologne'],
            nullable: true,
          },
          gender: { type: 'string', enum: ['male', 'female', 'unisex'] },
          topNotes: { type: 'string', nullable: true },
          heartNotes: { type: 'string', nullable: true },
          baseNotes: { type: 'string', nullable: true },
          imageUrl: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          BrandId: { type: 'string', format: 'uuid' },
          CategoryId: { type: 'string', format: 'uuid' },
          Brand: { $ref: '#/components/schemas/Brand' },
          Category: { $ref: '#/components/schemas/Category' },
          Inventory: { $ref: '#/components/schemas/Inventory' },
        },
      },
      ProductInput: {
        type: 'object',
        required: ['sku', 'name', 'price'],
        properties: {
          sku: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          price: { type: 'number' },
          costPrice: { type: 'number' },
          volumeMl: { type: 'integer' },
          fragranceType: { type: 'string', enum: ['eau_de_parfum', 'eau_de_toilette', 'parfum', 'cologne'] },
          gender: { type: 'string', enum: ['male', 'female', 'unisex'] },
          topNotes: { type: 'string' },
          heartNotes: { type: 'string' },
          baseNotes: { type: 'string' },
          imageUrl: { type: 'string' },
          brandId: { type: 'string', format: 'uuid' },
          categoryId: { type: 'string', format: 'uuid' },
          quantityInStock: { type: 'integer', default: 0 },
          reorderLevel: { type: 'integer', default: 5 },
        },
      },
      CartItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer' },
          UserId: { type: 'string', format: 'uuid' },
          ProductId: { type: 'string', format: 'uuid' },
          Product: { $ref: '#/components/schemas/Product' },
        },
      },
      Favorite: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          UserId: { type: 'string', format: 'uuid' },
          ProductId: { type: 'string', format: 'uuid' },
          Product: { $ref: '#/components/schemas/Product' },
        },
      },
      OrderItem: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          quantity: { type: 'integer' },
          unitPrice: { type: 'number' },
          subtotal: { type: 'number' },
          ProductId: { type: 'string', format: 'uuid' },
          Product: { $ref: '#/components/schemas/Product' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          orderNumber: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'pending_delivery', 'dispatched', 'delivered', 'cancelled'],
          },
          subtotal: { type: 'number' },
          shippingCost: { type: 'number' },
          totalAmount: { type: 'number' },
          paymentStatus: { type: 'string', enum: ['pending', 'completed', 'failed'] },
          paystackReference: { type: 'string' },
          shippingAddress: { type: 'string' },
          shippingStreet: { type: 'string' },
          shippingArea: { type: 'string' },
          shippingCity: { type: 'string' },
          shippingRegion: { type: 'string' },
          deliveredAt: { type: 'string', format: 'date-time', nullable: true },
          UserId: { type: 'string', format: 'uuid' },
          DeliveryPersonId: { type: 'string', format: 'uuid', nullable: true },
          OrderItems: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
        },
      },
      DeliveryPerson: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          phoneNumber: { type: 'string' },
          isActive: { type: 'boolean' },
          hasPin: { type: 'boolean' },
          hasPassword: { type: 'boolean' },
          activeDeliveries: { type: 'integer' },
        },
      },
      DeliveryFee: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          region: { type: 'string' },
          city: { type: 'string', default: 'Other' },
          fee: { type: 'number' },
        },
      },
      Issue: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          category: {
            type: 'string',
            enum: ['non_delivery', 'bad_product', 'wrong_item', 'damaged', 'other'],
          },
          description: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
          adminResponse: { type: 'string', nullable: true },
          respondedAt: { type: 'string', format: 'date-time', nullable: true },
          UserId: { type: 'string', format: 'uuid' },
          OrderId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
    },
    responses: {
      NotFound: {
        description: 'Resource not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      BadRequest: {
        description: 'Validation error',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Unauthorized: {
        description: 'Missing, invalid or expired token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated but not allowed to perform this action',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
  },
};

const options = {
  definition,
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
  ],
};

module.exports = swaggerJsdoc(options);
