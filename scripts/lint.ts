import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Project guard rails, not a general-purpose linter.
 *
 * The thesis product rules are non-negotiable: the domain layer must stay
 * pure, no patient identifiers may enter the schema or code, and no AI/ML
 * dependency may be introduced. TypeScript itself is checked by
 * `npm run typecheck`.
 */
const root = process.cwd();
const failures: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

const domainFiles = walk(join(root, "src/domain"));
const sourceFiles = walk(join(root, "src"));

const domainForbidden = [
  /from\s+["']react["']/,
  /from\s+["']dexie["']/,
  /from\s+["']@\/lib/,
  /from\s+["']@\/app/,
  /from\s+["']@\/server/,
  /from\s+["']@\/db/,
];
for (const file of domainFiles) {
  const text = readFileSync(file, "utf8");
  for (const pattern of domainForbidden) {
    if (pattern.test(text)) {
      failures.push(`${relative(root, file)} imports UI, storage or server code into the pure domain layer`);
    }
  }
}

const identifierPatterns = [
  /\bpatientName\s*[:=]/,
  /\bpatient_name\s*[:=]/,
  /\bmedicalRecordNumber\s*[:=]/,
  /\bmrn\s*[:=]/i,
  /\bdateOfBirth\s*[:=]/,
  /\bdate_of_birth\s*[:=]/,
  /\bpatientPhoto\s*[:=]/,
];
for (const file of sourceFiles) {
  const text = readFileSync(file, "utf8");
  for (const pattern of identifierPatterns) {
    if (pattern.test(text)) {
      failures.push(`${relative(root, file)} contains a patient identifier field (${pattern})`);
    }
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const dependencies = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
const aiPackages = dependencies.filter((name) => /openai|anthropic|tensorflow|onnx|transformers|@ai-sdk/i.test(name));
for (const name of aiPackages) failures.push(`package.json contains an AI/ML package: ${name}`);

const pageFiles = walk(join(root, "src/app")).filter((file) => file.endsWith("page.tsx"));
for (const file of pageFiles) {
  const text = readFileSync(file, "utf8");
  if (!/use client/.test(text)) failures.push(`${relative(root, file)} is missing the client boundary`);
}

if (failures.length) {
  console.error("Product-rule lint failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Product-rule lint passed (${sourceFiles.length} source files, ${domainFiles.length} domain files).`);
