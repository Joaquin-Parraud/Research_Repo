// Fails when the English and Spanish catalogues do not have exactly the same keys.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "locales");
const languages = ["en", "es"];

function flatten(value, prefix = "") {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

function load(language) {
  const dir = join(root, language);
  const keys = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const data = JSON.parse(readFileSync(join(dir, file), "utf8"));
    const namespace = file.replace(/\.json$/, "");
    for (const key of flatten(data)) keys.add(`${namespace}:${key}`);
  }
  return keys;
}

const [base, other] = languages.map(load);
let failed = false;
for (const [name, have, want] of [
  [languages[1], other, base],
  [languages[0], base, other],
]) {
  const missing = [...want].filter((key) => !have.has(key)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(`Missing in "${name}" (${missing.length}):`);
    for (const key of missing) console.error(`  ${key}`);
  }
}

if (failed) process.exit(1);
console.log(`Locales OK: ${base.size} keys in ${languages.join(" and ")}.`);
