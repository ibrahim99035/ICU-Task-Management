import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPool } from "../src/db";

const sql = readFileSync(resolve(process.cwd(), "scripts/schema.sql"), "utf8");
const pool = getPool();
try {
  await pool.query(sql);
  console.log("Schema applied.");
} finally {
  await pool.end();
}
