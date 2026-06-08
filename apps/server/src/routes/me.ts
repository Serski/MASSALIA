import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createDb, houses, players, professions, resources, users, worlds } from "@massalia/db";
import { remainingActions } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, findCharacterRow, withDailyReset } from "../services/character.js";
import { activeCensure } from "../services/politics.js";
import { recoverComposure } from "../services/composure.js";
import { isWithdrawn } from "@massalia/shared";

const db = createDb();

const classResourceByProfession: Record<string, string> = {
  landowner: "wheat",
  trader: "wine",
  priest: "herbal",
  philosopher: "prestige",
  shipbuilder: "gold",
  hetaira: "intelligence",
  hoplite: "militia",
  slave: "freedom",
};

function numberAmount(value: string | number | null | undefined) {
  return Number(value ?? 0);
}

export async function meRoutes(app: FastifyInstance) {
  app.get("/state", async (request, reply) => {
    const user = await requireAuth(request);
    const worldRows = await db.select().from(worlds).where(eq(worlds.status, "active")).limit(1);
    const world = worldRows[0];
    if (!world) {
      reply.code(503);
      return { error: "No active world exists." };
    }

    const rows = await db
      .select({
        player: players,
        profession: professions,
        house: houses,
      })
      .from(players)
      .innerJoin(professions, eq(professions.slug, players.professionSlug))
      .innerJoin(houses, eq(houses.slug, players.houseSlug))
      .where(and(eq(players.userId, user.id), eq(players.worldId, world.id), eq(players.isActive, true)))
      .limit(1);

    const state = rows[0];
    if (!state) {
      reply.code(404);
      return { error: "No active character found." };
    }

    // Canonical character sheet (stats, ideology, party, currency, actions).
    const ensured = await ensureCharacterRow(state.player, world.id);
    // Resolve any expired censure first (it may flip party), then read the row.
    const censure = await activeCensure(ensured.id);
    await recoverComposure(ensured.id);
    const character = await withDailyReset((await findCharacterRow(ensured.playerId, ensured.worldId)) ?? ensured, new Date());

    const resourceRows = await db.select().from(resources).where(and(eq(resources.scope, "player"), eq(resources.scopeId, state.player.id)));
    const resourceMap = new Map(resourceRows.map((resource) => [resource.type, numberAmount(resource.amount)]));
    const classResourceType = classResourceByProfession[state.profession.slug] ?? "favor";

    // Full per-type balance map so the inventory sheet can show every good the
    // player actually holds. Goods absent from the table render as 0 on the client.
    const balances: Record<string, number> = {};
    for (const resource of resourceRows) {
      balances[resource.type] = numberAmount(resource.amount);
    }

    const userRows = await db
      .select({ newsletterOptIn: users.newsletterOptIn })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    return {
      user: {
        ...user,
        newsletterOptIn: userRows[0]?.newsletterOptIn ?? false,
      },
      world: {
        id: world.id,
        name: world.name,
        seasonDay: Math.max(1, Math.floor((Date.now() - world.startedAt.getTime()) / 86_400_000) + 1),
        seasonEndsIn: Math.max(0, Math.ceil((world.endsAt.getTime() - Date.now()) / 86_400_000)),
      },
      character: {
        id: state.player.id,
        name: state.player.name,
        professionSlug: state.profession.slug,
        professionName: state.profession.name,
        professionRank: state.profession.rank,
        houseSlug: state.house.slug,
        houseName: state.house.name,
        houseStance: state.house.stance,
        faceId: state.player.faceId,
        // Party + ideology now come from the canonical character sheet.
        party: character.party,
        // -100 Traditionalist .. +100 Reformist, 0 = centre.
        ideology: character.ideology,
        composure: character.composure,
        drachmae: character.drachmae,
        actionsRemaining: remainingActions(character.actionsSpentToday),
        // Composure break: withdrawn from public life until breakUntil.
        withdrawn: isWithdrawn(character.breakUntil, new Date()),
        // Active party censure (ideology drift) for the HUD warning + countdown.
        censured: censure !== null,
        censureExpiresAt: censure ? censure.expiresAt.toISOString() : null,
        origin: state.player.origin,
      },
      resources: {
        // Drachmae is the canonical currency; surfaced as "gold" for the existing UI.
        gold: character.drachmae,
        prestige: character.prestige,
        influence: resourceMap.get("influence") ?? 0,
        classResource: {
          type: classResourceType,
          label: classResourceType[0]!.toUpperCase() + classResourceType.slice(1),
          amount: resourceMap.get(classResourceType) ?? 0,
        },
        balances,
      },
      // The 4-stat model, now sourced from the canonical character sheet.
      stats: {
        prestige: character.prestige,
        devotion: character.devotion,
        militia: character.militia,
        intelligence: character.intelligence,
      },
    };
  });

  // Wire the Settings newsletter toggle to the real users.newsletter_opt_in column.
  app.post("/newsletter", async (request) => {
    const user = await requireAuth(request);
    const optIn = (request.body as { optIn?: boolean } | undefined)?.optIn === true;
    await db.update(users).set({ newsletterOptIn: optIn }).where(eq(users.id, user.id));
    return { ok: true, newsletterOptIn: optIn };
  });
}
