import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  icuPool?: Pool;
  icuDb?: ReturnType<typeof drizzle<typeof schema>>;
};

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForDb.icuPool) {
    const url = process.env.DATABASE_URL;
    globalForDb.icuPool = new Pool({
      connectionString: url,
      max: 5,
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
  }
  if (!globalForDb.icuDb) {
    globalForDb.icuDb = drizzle(globalForDb.icuPool, { schema });
  }
  return globalForDb.icuDb;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  getDb();
  return globalForDb.icuPool!;
}

export { schema };
