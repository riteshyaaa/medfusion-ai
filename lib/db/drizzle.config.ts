import { defineConfig } from "drizzle-kit";
import { existsSync } from "node:fs";
import path from "path";

const envPath = path.resolve(process.cwd(), "../../.env");
if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function" && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

export default defineConfig({
  schema: "./src/schema/*.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/medscope_ai",
  },
});
