// Creates/updates all tables in MSSQL from the Sequelize models.
// Usage: npm run db:sync
//
// Deliberately does NOT use sequelize.sync({ alter: true }): Sequelize's MSSQL
// query generator emits `ALTER COLUMN ... UNIQUE`, which is invalid T-SQL (SQL
// Server only allows UNIQUE via ADD CONSTRAINT, not inline on ALTER COLUMN).
// Since alter-sync runs changeColumn on every existing column unconditionally,
// this breaks on the first unique column it touches (email, sku, orderNumber,
// ...) even when that column already matches the model. Instead: a plain
// sync() creates missing tables/indexes (safe — never calls changeColumn),
// then any columns added to a model since the table was created are added
// by hand.
require('dotenv').config();
const { sequelize } = require('../models');

(async () => {
  try {
    await sequelize.authenticate();

    await sequelize.sync(); // create any missing tables (correct FK order) + missing indexes

    const qi = sequelize.getQueryInterface();
    for (const model of Object.values(sequelize.models)) {
      const tableName = model.getTableName();
      const existingColumns = await qi.describeTable(tableName);
      for (const [attrName, attribute] of Object.entries(model.getAttributes())) {
        const columnName = attribute.field || attrName;
        if (!existingColumns[columnName]) {
          console.log(`  + adding column ${tableName}.${columnName}`);
          await qi.addColumn(tableName, columnName, attribute);
        }
      }
    }

    await sequelize.sync(); // pick up indexes for any columns just added

    console.log('✓ Database synced — all tables created/updated');
    process.exit(0);
  } catch (err) {
    console.error('✗ Sync failed:', err.message);
    process.exit(1);
  }
})();
