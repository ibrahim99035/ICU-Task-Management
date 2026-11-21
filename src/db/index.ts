import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  tasklogPool?: Pool;
  tasklogDb?: ReturnType<typeof drizzle<typeof schema>>;
};

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getDb() {
  if (!process.env.DATABASE_URL) return null;
  if (!globalForDb.tasklogPool) {
    const url = process.env.DATABASE_URL;
    globalForDb.tasklogPool = new Pool({
      connectionString: url,
      max: 5,
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
  }
  if (!globalForDb.tasklogDb) {
    globalForDb.tasklogDb = drizzle(globalForDb.tasklogPool, { schema });
  }
  return globalForDb.tasklogDb;
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  getDb();
  return globalForDb.tasklogPool!;
}

export { schema };
