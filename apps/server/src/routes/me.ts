import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { createDb, houses, players, professions, resources, users, worlds } from "@massalia/db";
import { currentAge, decayBandFor, formatGameDate, gameDate, isDeceased, isWithdrawn, lifeStage, portraitFor } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { ensureCharacterRow, findCharacterRow } from "../services/character.js";
import { activeCensure } from "../services/politics.js";
import { recoverComposure } from "../services/composure.js";
import { decayCharacter, getAgeConfig, portraitUrl } from "../services/age.js";
import { enforceDeathAndHandoff, regentBadge, successionInfo } from "../services/succession.js";
import { closeDueFestivals, fireFestivalsForCharacter, liveFestivalForCharacter } from "../services/festival.js";
import { olympiadStatus, syncOlympiadForCharacter } from "../services/olympiad.js";
import { manumissionStatus } from "../services/manumission.js";
import { syncAgenda } from "../services/agenda.js";
import { syncElections } from "../services/elections.js";

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
    // Lazy old-age decay on the same read path (accrues stat decline; no loop).
    await decayCharacter(ensured.id);
    // Death enforcement + regency handoff (lazy on read; same callable path future
    // assassination/battle reuse). May flip status to 'deceased' -> opens succession.
    await enforceDeathAndHandoff(ensured.id);
    const character = (await findCharacterRow(ensured.playerId, ensured.worldId)) ?? ensured;

    // A pending succession blocks normal play until the player picks an heir.
    const succession = await successionInfo(character);
    const regent = await regentBadge(character);
    // A regency handoff (during this read) renames the slot — re-read the player
    // identity so the response reflects the heir, not the previous holder.
    const refreshedPlayer = await db.select({ name: players.name, faceId: players.faceId }).from(players).where(eq(players.id, state.player.id)).limit(1);
    const slotName = refreshedPlayer[0]?.name ?? state.player.name;
    const slotFaceId = refreshedPlayer[0]?.faceId ?? state.player.faceId;

    // Annual festivals (Prompt 7): lazy fire any festival live this season + close
    // any whose season has passed, then surface the live one for the HUD banner.
    await closeDueFestivals();
    await fireFestivalsForCharacter(character);
    const festival = await liveFestivalForCharacter(character);

    // Olympiad (Prompt 8): advance any due cycle + deliver the nominate card lazily,
    // then surface the cycle status (phase, badges, live event, city-wide victor).
    await syncOlympiadForCharacter(character);
    const olympiad = await olympiadStatus(character);

    // Elections (Politics Prompt 2): open due declarations, advance phases, and
    // reconcile office vacancies (death cascade + defection forfeit) on the same
    // lazy-on-read net the worker sweep also drives.
    await syncElections();

    // The Agenda & three governments (Politics Prompt 3): accrue treasuries, seat
    // the party leaders, and advance the league + party agenda cycles, lazily.
    await syncAgenda();

    // Manumission (the slave's path out): is this a slave who has earned freedom?
    const manumission = await manumissionStatus(character);

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

    // Written in-game date, derived from the world's DB start instant.
    const worldGameDate = gameDate(Date.now(), world.startedAt.getTime());

    // Life-arc for the character sheet: age, stage, aging portrait, decay band.
    const ageCfg = getAgeConfig();
    const age = currentAge(character.startAge, character.createdAt.getTime(), Date.now(), ageCfg);
    const decayingStats = Object.keys(decayBandFor(age, ageCfg));

    return {
      user: {
        ...user,
        newsletterOptIn: userRows[0]?.newsletterOptIn ?? false,
      },
      world: {
        id: world.id,
        name: world.name,
        // In-game date: 1 real day = 1 season, counting BC years down from 300.
        gameDate: worldGameDate,
        gameDateLabel: formatGameDate(worldGameDate),
        // Secondary real-time countdown to the end of the 182-day run.
        seasonEndsIn: Math.max(0, Math.ceil((world.endsAt.getTime() - Date.now()) / 86_400_000)),
      },
      character: {
        id: state.player.id,
        name: slotName,
        professionSlug: state.profession.slug,
        professionName: state.profession.name,
        professionRank: state.profession.rank,
        houseSlug: state.house.slug,
        houseName: state.house.name,
        houseStance: state.house.stance,
        faceId: slotFaceId,
        // Party + ideology now come from the canonical character sheet.
        party: character.party,
        // -100 Traditionalist .. +100 Reformist, 0 = centre.
        ideology: character.ideology,
        composure: character.composure,
        drachmae: character.drachmae,
        // Composure break: withdrawn from public life until breakUntil.
        withdrawn: isWithdrawn(character.breakUntil, new Date()),
        // Active party censure (ideology drift) for the HUD warning + countdown.
        censured: censure !== null,
        censureExpiresAt: censure ? censure.expiresAt.toISOString() : null,
        origin: state.player.origin,
        // Life-arc (age pack). portrait ages with the character; `decaying` lists
        // the stats currently in a decay band (prestige is never among them).
        // deceased is display-only — succession is a later pack.
        avatarId: character.avatarId,
        startAge: character.startAge,
        currentAge: age,
        lifeStage: lifeStage(age, ageCfg),
        portrait: portraitUrl(portraitFor(character.avatarId ?? "", age, ageCfg)),
        deceased: character.deathAge !== null ? isDeceased(age, character.deathAge) : false,
        decaying: decayingStats,
        // Regency (Prompt C): the HUD badge + the offices a regent is barred from.
        regent,
      },
      // A pending succession (the character has died) — the client shows the
      // blocking Succession screen until an heir is chosen.
      succession,
      // The festival live for the player this season (a free civic event), or null.
      festival,
      // The Olympiad cycle status (Prompt 8): phase, your candidacy/vote/delegate
      // badges, the live Olympic event, and the city-wide victor — or null.
      olympiad,
      // Manumission: { eligible } when a slave holds the freedman trait — the
      // signal for the client's "Claim Your Freedom" panel.
      manumission,
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
