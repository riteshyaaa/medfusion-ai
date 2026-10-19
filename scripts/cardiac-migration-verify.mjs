import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const pg = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");

const url = readFileSync(".env", "utf8").match(/^DATABASE_URL=(.+)$/m)[1].trim();
const parsed = new URL(url);
const testDbName = "medscope_migration_verification_" + Date.now().toString(36);

async function main() {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    // Isolated scratch database, never the configured development database.
    await admin.query(`CREATE DATABASE "${testDbName}"`);
    const testUrl = new URL(url);
    testUrl.pathname = `/${testDbName}`;

    const run = () => execSync(
      `DATABASE_URL="${testUrl.toString()}" pnpm --filter @workspace/db migrate 2>&1 | tail -2`,
      { encoding: "utf8", cwd: process.cwd(), shell: "bash" },
    );
    console.log("apply 1:", run().trim());
    console.log("apply 2 (repeatability):", run().trim());

    const check = new pg.Client({ connectionString: testUrl.toString() });
    await check.connect();
    const tables = await check.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    console.log("tables in isolated db:", tables.rows.map((row) => row.tablename).join(", "));
    const cols = await check.query("SELECT column_name FROM information_schema.columns WHERE table_name='cardiac_ai_explanations' ORDER BY ordinal_position");
    console.log("cardiac_ai_explanations columns:", cols.rows.map((row) => row.column_name).join(", "));
    const cardiacCols = await check.query("SELECT column_name FROM information_schema.columns WHERE table_name='cardiac_assessments' AND column_name IN ('measurement_source','contextual_factors')");
    console.log("cardiac_assessments new columns:", cardiacCols.rows.map((row) => row.column_name).join(", "));
    await check.end();
    await admin.query(`DROP DATABASE "${testDbName}"`);
    console.log("isolated database dropped:", testDbName);
  } finally {
    await admin.end();
  }
}

main().catch((error) => { console.error("MIGRATION VERIFICATION FAILED:", error.message); process.exit(1); });
