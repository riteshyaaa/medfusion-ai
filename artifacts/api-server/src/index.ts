import { serve } from "@hono/node-server";
import app from "./app";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

serve({
  fetch: app.fetch,
  port,
}, () => {
  console.log(`Server listening on port ${port}`);
});