import "dotenv/config";
import bcrypt from "bcryptjs";
import { getDb, getPool, schema } from "../src/db";
import { DEMO_TEMPLATES } from "../src/lib/demo-data";

const DEMO_USERS = [
  { id: "u-nurse-1", username: "amina", pin: "1111", role: "nurse" as const, displayName: "Amina Hassan", participantCode: "N01" },
  { id: "u-nurse-2", username: "yara", pin: "2222", role: "nurse" as const, displayName: "Yara Saleh", participantCode: "N02" },
  { id: "u-nurse-3", username: "omar", pin: "3333", role: "nurse" as const, displayName: "Omar Khaled", participantCode: "N03" },
  { id: "u-head-1", username: "head", pin: "9999", role: "head_nurse" as const, displayName: "Layla Mansour, RN", participantCode: "H01" },
];

const db = getDb();
if (!db) throw new Error("DATABASE_URL is not configured");

for (const user of DEMO_USERS) {
  const pinHash = await bcrypt.hash(user.pin, 10);
  await db
    .insert(schema.users)
    .values({
      id: user.id,
      username: user.username,
      pinHash,
      role: user.role,
      displayName: user.displayName,
      participantCode: user.participantCode,
    })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { username: user.username, pinHash, role: user.role, displayName: user.displayName, participantCode: user.participantCode },
    });
}

for (const template of DEMO_TEMPLATES) {
  await db
    .insert(schema.taskTemplates)
    .values(template)
    .onConflictDoUpdate({
      target: schema.taskTemplates.id,
      set: {
        name: template.name,
        category: template.category,
        tier: template.tier,
        intervalMin: template.intervalMin,
        expectedMin: template.expectedMin,
        offsetMin: template.offsetMin,
        active: template.active,
      },
    });
}

const config = {
  missedTimeoutMin: 30,
  alertLeadMin: 10,
  idleLockSec: 60,
  rescheduleOffsetMode: "emergency_duration",
  fixedOffsetMin: 0,
};
await db
  .insert(schema.config)
  .values({ key: "app", value: config })
  .onConflictDoUpdate({ target: schema.config.key, set: { value: config } });

console.log(`Seeded ${DEMO_USERS.length} users and ${DEMO_TEMPLATES.length} templates.`);
console.log("Demo PINs: amina/1111, yara/2222, omar/3333, head/9999");
await getPool().end();
