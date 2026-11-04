// Applies src/db/schema.sql (WARNING: drops and recreates all tables)
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Schema applied');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
