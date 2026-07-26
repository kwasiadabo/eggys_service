require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');
const routes = require('./routes');
const { sequelize } = require('./models');
const swaggerSpec = require('./config/swagger');
const { apiLimiter } = require('./middleware/rateLimit');

const app = express();

// crossOriginResourcePolicy relaxed for /uploads — product images are meant
// to be embeddable cross-origin by the storefront frontend.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Render sits behind a reverse proxy — without this, req.protocol always
// reports 'http' even on an HTTPS request, breaking the self-origin check below.
app.set('trust proxy', 1);

// CLIENT_URL may be a single origin or a comma-separated list (local dev + deployed frontend)
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5199')
	.split(',')
	.map((origin) => origin.trim());

app.use(
	cors((req, callback) => {
		const origin = req.header('Origin');
		const selfOrigin = `${req.protocol}://${req.get('host')}`;
		// Always allow the API's own origin — needed for the Swagger "Try it out" UI at /api/docs
		const isAllowed =
			!origin || origin === selfOrigin || allowedOrigins.includes(origin);
		if (isAllowed) return callback(null, { origin: true, credentials: true });
		callback(new Error(`Origin ${origin} is not allowed by CORS`));
	}),
);
// Keep the raw body around — Paystack webhook signatures are computed over the raw payload
app.use(
	express.json({
		verify: (req, _res, buf) => {
			req.rawBody = buf;
		},
	}),
);
app.use(morgan('dev'));

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
app.use(
	'/api/docs',
	swaggerUi.serve,
	swaggerUi.setup(swaggerSpec, { customSiteTitle: 'VX Perfumery API Docs' }),
);
app.use('/api', apiLimiter, routes);

app.use((err, _req, res, _next) => {
	console.error(err);
	res
		.status(err.status || 500)
		.json({ error: err.message || 'Internal server error' });
});

const port = process.env.PORT || 5000;

async function start() {
	try {
		await sequelize.authenticate();
		console.log('✓ MSSQL connection established');
	} catch (err) {
		console.error(
			'✗ Could not connect to MSSQL — check .env DB settings:',
			err.message,
		);
	}
	app.listen(port, () =>
		console.log(`VX Perfumery API running on http://localhost:${port}`),
	);
}

start();
