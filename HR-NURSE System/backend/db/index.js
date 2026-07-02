/**
 * Database abstraction layer.
 *
 * Supports two engines selected via the DB_ENGINE env var:
 *   - "sqlite"   (default) zero-config, single file. Great for one clinic / one server.
 *   - "postgres" server-grade, multi-connection. Used by the production installer.
 *
 * All application code uses positional "?" placeholders and calls:
 *   db.query(sql, params)  -> { rows }
 *   db.get(sql, params)    -> single row or undefined
 *   db.run(sql, params)    -> { changes, lastId }
 *
 * The wrapper translates "?" to "$1, $2 ..." for Postgres automatically.
 */
const path = require('path');

const ENGINE = (process.env.DB_ENGINE || 'sqlite').toLowerCase();

let impl;

if (ENGINE === 'postgres' || ENGINE === 'pg') {
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.PGHOST || 'localhost',
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER || 'hrnurse',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'hrnurse',
    max: 10,
  });

  // Convert "?" placeholders to "$1, $2, ..."
  const toPg = (sql) => {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  };

  impl = {
    engine: 'postgres',
    async query(sql, params = []) {
      const res = await pool.query(toPg(sql), params);
      return { rows: res.rows };
    },
    async get(sql, params = []) {
      const res = await pool.query(toPg(sql), params);
      return res.rows[0];
    },
    async run(sql, params = []) {
      // Append RETURNING id for inserts when not present, to recover lastId.
      let q = sql;
      const isInsert = /^\s*insert/i.test(sql);
      if (isInsert && !/returning/i.test(sql)) q = sql.replace(/;?\s*$/, ' RETURNING id');
      const res = await pool.query(toPg(q), params);
      return {
        changes: res.rowCount,
        lastId: res.rows && res.rows[0] ? res.rows[0].id : undefined,
      };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
} else {
  const Database = require('better-sqlite3');
  const file = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'hrnurse.db');
  require('fs').mkdirSync(path.dirname(file), { recursive: true });
  const sdb = new Database(file);
  sdb.pragma('journal_mode = WAL');
  sdb.pragma('foreign_keys = ON');

  impl = {
    engine: 'sqlite',
    async query(sql, params = []) {
      const rows = sdb.prepare(sql).all(...params);
      return { rows };
    },
    async get(sql, params = []) {
      return sdb.prepare(sql).get(...params);
    },
    async run(sql, params = []) {
      const info = sdb.prepare(sql).run(...params);
      return { changes: info.changes, lastId: info.lastInsertRowid };
    },
    async exec(sql) {
      sdb.exec(sql);
    },
    async close() {
      sdb.close();
    },
  };
}

module.exports = impl;
