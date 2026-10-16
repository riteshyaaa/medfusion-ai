import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (typeof process.loadEnvFile === "function" && existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const rawPort = process.env.API_PORT ?? "3001";

const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error("API_PORT must be a valid TCP port.");
}

const { default: app } = await import("./app");
const server = serve({
  fetch: app.fetch,
  port,
  hostname: process.env.API_HOST ?? "127.0.0.1",
}, () => {
  console.info(JSON.stringify({ event: "server_started", port }));
});

const httpServer = server as import("node:http").Server;
httpServer.requestTimeout = 30_000;
httpServer.headersTimeout = 35_000;
httpServer.keepAliveTimeout = 5_000;
