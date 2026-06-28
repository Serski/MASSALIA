import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { authRoutes } from "./routes/auth.js";
import { characterRoutes } from "./routes/characters.js";
import { characterSheetRoutes } from "./routes/character.js";
import { eventRoutes } from "./routes/events.js";
import { meRoutes } from "./routes/me.js";
import { partyRoutes } from "./routes/party.js";
import { worldRoutes } from "./routes/world.js";
import { routineRoutes } from "./routes/routines.js";
import { familyRoutes } from "./routes/family.js";
import { festivalRoutes } from "./routes/festival.js";
import { olympiadRoutes } from "./routes/olympiad.js";
import { manumissionRoutes } from "./routes/manumission.js";
import { agendaRoutes } from "./routes/agenda.js";
import { loadAgendaContent } from "./services/agenda.js";
import { oligarchyRoutes } from "./routes/oligarchy.js";
import { electionRoutes } from "./routes/elections.js";
import { officeRoutes } from "./routes/offices.js";
import { standingsRoutes } from "./routes/standings.js";
import { leagueRoutes, loadLeagueContent } from "./routes/league.js";
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
import { electionConfig } from "@massalia/shared";

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
// Validate content JSON at boot — fail fast on a malformed file.
await loadTraitDefs();
await loadComposureConfig();
await listEvents();
await loadRoutineContent();
await loadAgeConfig();
await loadFamilyConfig();
await loadCalendarConfig();
await loadPoliticsConfig();
await loadAgendaContent();
await loadBuildingsContent();
await loadPopsContent();
await loadRanksContent();
await loadContractsContent();
// Fail fast on a malformed election block (Politics Prompt 2).
electionConfig(getCalendarConfig());
// Atlas Phase 2a: validate the cities + factions content at boot.
await loadLeagueContent();

app.get("/health", async () => ({ ok: true }));
await app.register(authRoutes, { prefix: "/auth" });
await app.register(characterRoutes, { prefix: "/characters" });
await app.register(characterSheetRoutes, { prefix: "/api/character" });
await app.register(meRoutes, { prefix: "/me" });
await app.register(partyRoutes, { prefix: "/api/party" });
await app.register(worldRoutes, { prefix: "/api/world" });
await app.register(eventRoutes, { prefix: "/api/events" });
await app.register(routineRoutes, { prefix: "/api/routines" });
await app.register(familyRoutes, { prefix: "/api/family" });
await app.register(festivalRoutes, { prefix: "/api/festivals" });
await app.register(olympiadRoutes, { prefix: "/api/olympics" });
await app.register(manumissionRoutes, { prefix: "/api/manumission" });
await app.register(agendaRoutes, { prefix: "/api/agenda" });
await app.register(oligarchyRoutes, { prefix: "/api/oligarchy" });
await app.register(electionRoutes, { prefix: "/api/elections" });
await app.register(officeRoutes, { prefix: "/api/offices" });
await app.register(standingsRoutes, { prefix: "/api/standings" });
await app.register(leagueRoutes, { prefix: "/api/league" });
await app.register(buildingRoutes, { prefix: "/api/buildings" });
await app.register(serviceRoutes, { prefix: "/api/service" });
await app.register(mercRoutes, { prefix: "/api/merc" });

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
