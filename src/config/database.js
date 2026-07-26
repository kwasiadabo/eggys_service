const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'vx_perfumery',
  process.env.DB_USER || 'sa',
  process.env.DB_PASSWORD || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 1433,
    dialect: 'mssql',
    logging: false,
    dialectOptions: {
      options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: true,
        requestTimeout: 60000, // hosted MSSQL can be slow on bursts of queries
        connectTimeout: 30000,
      },
    },
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 },
  }
);

module.exports = sequelize;
