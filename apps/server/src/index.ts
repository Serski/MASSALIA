import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { eventRoutes } from "./routes/events.js";
import { worldRoutes } from "./routes/world.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  credentials: true,
});
await app.register(cookie);
await app.register(fastifyStatic, {
  root: path.join(repoRoot, "content"),
  prefix: "/content/",
});
await app.register(worldRoutes, { prefix: "/api/world" });
await app.register(eventRoutes, { prefix: "/api/events" });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
