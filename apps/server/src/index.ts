import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { endDbPools } from "@massalia/db";
import { errorHandler } from "./errorHandler.js";
import { closeQueue } from "./services/queue.js";
import { registerRateLimit } from "./rateLimit.js";
import { registerHealthRoute } from "./health.js";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { characterSheetRoutes } from "./routes/character.js";
import { eventRoutes } from "./routes/events.js";
import { storyRoutes } from "./routes/stories.js";
import { meRoutes } from "./routes/me.js";
import { partyRoutes } from "./routes/party.js";
import { routineRoutes } from "./routes/routines.js";
import { familyRoutes } from "./routes/family.js";
import { festivalRoutes } from "./routes/festival.js";
import { olympiadRoutes } from "./routes/olympiad.js";
import { manumissionRoutes } from "./routes/manumission.js";
import { agendaRoutes } from "./routes/agenda.js";
import { loadAgendaContent } from "./services/agenda.js";
import { oligarchyRoutes } from "./routes/oligarchy.js";
import { interactionRoutes } from "./routes/interactions.js";
import { loadInteractionsConfig } from "./services/interactions.js";
import { electionRoutes } from "./routes/elections.js";
import { officeRoutes } from "./routes/offices.js";
import { standingsRoutes } from "./routes/standings.js";
import { leagueRoutes, loadLeagueContent } from "./routes/league.js";
import { mapRoutes } from "./routes/map.js";
import { buildingRoutes } from "./routes/buildings.js";
import { loadBuildingsContent, loadPopsContent } from "./services/buildings.js";
import { serviceRoutes } from "./routes/service.js";
import { loadRanksContent } from "./services/service.js";
import { mercRoutes } from "./routes/merc.js";
import { loadContractsContent } from "./services/merc.js";
import { loadTraitDefs } from "./services/traits.js";
import { loadComposureConfig } from "./services/composure.js";
import { listEvents } from "./services/eventEngine.js";
import { loadRoutineContent } from "./services/routines.js";
import { loadAgeConfig } from "./services/age.js";
import { loadFamilyConfig } from "./services/family.js";
import { loadCalendarConfig, getCalendarConfig } from "./services/festival.js";
import { loadPoliticsConfig } from "./services/oligarchy.js";
import { loadStories } from "./services/story.js";
import { ensureMilitaryPools } from "./services/mapMilitary.js";
import { electionConfig } from "@massalia/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");

// Trust exactly ONE hop (Railway's edge proxy) — NOT `true`, which would trust
// arbitrary client-supplied X-Forwarded-For chains and let an attacker spoof their
// IP to bypass per-IP rate limiting. This is the function form of the former
// `trustProxy: 1` (proxy-addr compiled a hop count n to `(addr, hop) => hop < n`).
// fastify >= 5.12 dropped the number from the option's typing AND makes a numeric
// value fail closed at runtime (trusts no hop at all), which would have left the
// rate limiter seeing the proxy's address for every client.
const app = Fastify({ logger: true, trustProxy: (_address: string, hop: number) => hop < 1 });
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to at least 32 characters");
}

// One error shape for every route (see errorHandler.ts): 4xx keep their status +
// message, 5xx are logged and answered with a fixed message.
app.setErrorHandler(errorHandler);

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  credentials: true,
});
await app.register(cookie, { secret: sessionSecret });
// Global limiter (rateLimit.ts): after cookie (the key reads the session), before
// every route (its onRoute hook budgets /api/ mutations). /content/ is exempt.
await registerRateLimit(app);
await app.register(fastifyStatic, {
  root: path.join(repoRoot, "content"),
  prefix: "/content/",
});
// Validate content JSON at boot — fail fast on a malformed file.
await loadTraitDefs();
await loadComposureConfig();
await listEvents();
await loadRoutineContent();
await loadAgeConfig();
await loadFamilyConfig();
await loadCalendarConfig();
await loadPoliticsConfig();
await loadInteractionsConfig();
await loadAgendaContent();
await loadBuildingsContent();
await loadPopsContent();
await loadRanksContent();
await loadContractsContent();
// Fail fast on a malformed election block (Politics Prompt 2).
electionConfig(getCalendarConfig());
// Atlas Phase 2a: validate the cities + factions content at boot.
await loadLeagueContent();
// Story engine (Pack 3): validate every authored story graph + upsert into `stories`.
await loadStories();
// World 2 military pools: backfill the active world's town/region rows from
// content (ON CONFLICT DO NOTHING — existing pools are never overwritten).
await ensureMilitaryPools();

// SELECT 1 + Redis PING (2s each); 503 names the failing part. Rate-limit exempt.
registerHealthRoute(app);
await app.register(authRoutes, { prefix: "/auth" });
await app.register(characterRoutes, { prefix: "/characters" });
await app.register(characterSheetRoutes, { prefix: "/api/character" });
await app.register(meRoutes, { prefix: "/me" });
await app.register(partyRoutes, { prefix: "/api/party" });
await app.register(eventRoutes, { prefix: "/api/events" });
await app.register(storyRoutes, { prefix: "/api/stories" });
await app.register(routineRoutes, { prefix: "/api/routines" });
await app.register(familyRoutes, { prefix: "/api/family" });
await app.register(festivalRoutes, { prefix: "/api/festivals" });
await app.register(olympiadRoutes, { prefix: "/api/olympics" });
await app.register(manumissionRoutes, { prefix: "/api/manumission" });
await app.register(agendaRoutes, { prefix: "/api/agenda" });
await app.register(oligarchyRoutes, { prefix: "/api/oligarchy" });
await app.register(interactionRoutes, { prefix: "/api/interactions" });
await app.register(electionRoutes, { prefix: "/api/elections" });
await app.register(officeRoutes, { prefix: "/api/offices" });
await app.register(standingsRoutes, { prefix: "/api/standings" });
await app.register(leagueRoutes, { prefix: "/api/league" });
await app.register(mapRoutes, { prefix: "/api/map" });
await app.register(buildingRoutes, { prefix: "/api/buildings" });
await app.register(serviceRoutes, { prefix: "/api/service" });
await app.register(mercRoutes, { prefix: "/api/merc" });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });

// --- Graceful shutdown -------------------------------------------------------
// Railway sends SIGTERM on every redeploy. Stop accepting connections, let the
// in-flight requests (and the transactions inside them) finish for up to 10s,
// close the BullMQ producer and the pg pools, then exit 0. A second signal is
// ignored (the first shutdown is already running).
const SHUTDOWN_GRACE_MS = 10_000;
let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info(`${signal} received: draining (up to ${SHUTDOWN_GRACE_MS / 1000}s for in-flight requests)`);
  const grace = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), SHUTDOWN_GRACE_MS).unref());
  // app.close(): no new connections, idle keep-alives dropped, in-flight requests
  // run to completion. Long-lived SSE streams never complete, hence the cap.
  const outcome = await Promise.race([app.close().then(() => "closed" as const), grace]);
  if (outcome === "timeout") app.log.warn("Shutdown grace period elapsed with connections still open; closing pools anyway.");
  await closeQueue();
  await endDbPools();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
