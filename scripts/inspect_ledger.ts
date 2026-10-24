import { getPostgresPool } from '../server/postgresPool';

async function inspectLedger() {
  const pool = getPostgresPool();
  if (!pool) return;

  const cols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'spark_transactions_ledger';
  `);

  console.log('spark_transactions_ledger Columns:');
  cols.rows.forEach(c => console.log(`  ${c.column_name}: ${c.data_type}`));

  await pool.end();
  process.exit(0);
}

inspectLedger();
