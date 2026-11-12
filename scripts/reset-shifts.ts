import "dotenv/config";
import { getPool } from "../src/db";

/**
 * Removes shifts created by UI smoke tests and manual capture runs.
 *
 * Seeded/simulated rows (`sim-...`) are kept. Users, templates, config and
 * survey responses are kept. This is destructive, so it requires --yes.
 */
if (!process.argv.includes("--yes")) {
  console.error("Refusing to delete shifts without --yes.");
  process.exit(1);
}

const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const count = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM shifts WHERE id NOT LIKE 'sim-%'",
  );
  await client.query(
    "DELETE FROM events WHERE shift_id IN (SELECT id FROM shifts WHERE id NOT LIKE 'sim-%')",
  );
  await client.query(
    "DELETE FROM handover_reports WHERE shift_id IN (SELECT id FROM shifts WHERE id NOT LIKE 'sim-%')",
  );
  await client.query(
    "DELETE FROM shift_reviews WHERE shift_id IN (SELECT id FROM shifts WHERE id NOT LIKE 'sim-%')",
  );
  await client.query(
    "DELETE FROM beds WHERE shift_id IN (SELECT id FROM shifts WHERE id NOT LIKE 'sim-%')",
  );
  await client.query("DELETE FROM shifts WHERE id NOT LIKE 'sim-%'");
  await client.query("COMMIT");
  console.log(`Deleted ${count.rows[0]?.count ?? 0} non-simulated shift(s) and their events.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
