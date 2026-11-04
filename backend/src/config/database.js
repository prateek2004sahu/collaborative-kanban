const { Pool } = require('pg');
const env = require('./env');

// Return DATE columns as plain 'YYYY-MM-DD' strings (not JS Date objects)
require('pg').types.setTypeParser(1082, (v) => v);

const pool = new Pool({ connectionString: env.databaseUrl, max: 20 });

/** Simple query helper */
const query = (text, params) => pool.query(text, params);

/**
 * Run several queries inside ONE transaction.
 * If the callback throws, everything is rolled back.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
