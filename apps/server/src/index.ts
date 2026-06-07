import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { eventRoutes } from "./routes/events.js";
import { meRoutes } from "./routes/me.js";
import { partyRoutes } from "./routes/party.js";
import { worldRoutes } from "./routes/world.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

const app = Fastify({ logger: true });
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters");
}

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  credentials: true,
});
await app.register(cookie, { secret: sessionSecret });
await app.register(fastifyStatic, {
  root: path.join(repoRoot, "content"),
  prefix: "/content/",
});
app.get("/health", async () => ({ ok: true }));
await app.register(authRoutes, { prefix: "/auth" });
await app.register(characterRoutes, { prefix: "/characters" });
await app.register(meRoutes, { prefix: "/me" });
await app.register(partyRoutes, { prefix: "/party" });
await app.register(worldRoutes, { prefix: "/api/world" });
await app.register(eventRoutes, { prefix: "/api/events" });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
