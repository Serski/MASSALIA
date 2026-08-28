import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  buildChronicle,
  OLYMPIAD_GAMES_FESTIVAL_ID,
  type ChronicleAfflictionRow,
  type ChronicleDeathRow,
  type ChronicleEntry,
  type ChronicleInput,
  type DeathCause,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { alias } from "drizzle-orm/pg-core";
import {
  children,
  familyCandidates,
  festivalChoregos,
  festivalDonations,
  festivalEvents,
  houses,
  interactions,
  marriages,
  olympicCandidates,
  players,
  playerCharacters,
  successions,
} from "./schema.js";
import { worldStartedMs } from "./festival.js";
import { olympiadDelegates } from "./olympiad.js";

const db = createDb();

// ---------------------------------------------------------------------------
// The Player Chronicle (Timeline) fetch layer: gather the already-persisted
// life-events for a dynasty and hand them to the pure aggregator in
// @massalia/shared. Read-only — no writes, no new tables.
//
// Dynasty scope (not raw houseSlug): the player_characters row is REUSED across
// generations — the heir overwrites the same slot and dynasties.generation
// increments at each succession. So every event keys to the single slot id, and
// the generation an event belongs to is derived from the dynasty's succession
// instants (see buildChronicle). houseSlug is NOT unique across players, so it is
// the wrong key; we resolve the slot's dynasty instead.
// ---------------------------------------------------------------------------

// Festival_events also carries the Olympic nominate/Games cards; those are their
// own chronicle type (olympic_selection), so the festival-participation pull
// excludes them. The configured Olympiad id is "olympiad" (calendar-config).
const OLYMPIAD_NOMINATE_FESTIVAL_ID = "olympiad";
// Auto-resolved or window-expired festival cards are not meaningful participation.
const NON_PARTICIPATION_CHOICES = ["attend", "expired"];

export async function gatherChronicleForCharacter(characterId: string): Promise<ChronicleEntry[]> {
  const slot = (
    await db
      .select({ id: playerCharacters.id, dynastyId: playerCharacters.dynastyId, adoptedCandidateId: playerCharacters.adoptedCandidateId })
      .from(playerCharacters)
      .where(eq(playerCharacters.id, characterId))
      .limit(1)
  )[0];
  if (!slot) return [];

  const startedMs = await worldStartedMs();
  if (startedMs === null) return [];

  // Succession rows for this dynasty: every occurredAt is a generation boundary, and
  // each death handoff (blood/adopted/fresh — NOT a regent maturation) is also a
  // death entry, carrying the age at death and the recorded cause.
  const successionRows = slot.dynastyId
    ? await db
        .select({ id: successions.id, kind: successions.kind, fromAge: successions.fromAge, cause: successions.cause, occurredAt: successions.occurredAt })
        .from(successions)
        .where(eq(successions.dynastyId, slot.dynastyId))
    : [];
  const successionBoundariesMs = successionRows.map((row) => row.occurredAt.getTime());
  const DEATH_KINDS = new Set(["blood", "adopted", "fresh"]);
  const deaths: ChronicleDeathRow[] = successionRows
    .filter((row) => DEATH_KINDS.has(row.kind))
    .map((row) => ({ id: row.id, at: row.occurredAt.getTime(), age: row.fromAge, cause: (row.cause as DeathCause | null) ?? null }));

  // Marriages (spouse display name via the consumed family candidate).
  const marriageRows = await db
    .select({ id: marriages.id, marriedAt: marriages.marriedAt, spouseName: familyCandidates.name, endedAt: marriages.endedAt, endReason: marriages.endReason })
    .from(marriages)
    .innerJoin(familyCandidates, eq(familyCandidates.id, marriages.candidateId))
    .where(eq(marriages.characterId, slot.id));

  // The current adopted heir (in-life rite), dated at the candidate's consumedAt.
  // adoptedCandidateId holds only the standing heir (ruling B/C — no re-adoption).
  let adoptions: ChronicleInput["adoptions"] = [];
  if (slot.adoptedCandidateId) {
    const adoptRows = await db
      .select({ id: familyCandidates.id, heirName: familyCandidates.name, houseName: houses.name, consumedAt: familyCandidates.consumedAt })
      .from(familyCandidates)
      .innerJoin(houses, eq(houses.slug, familyCandidates.houseSlug))
      .where(eq(familyCandidates.id, slot.adoptedCandidateId))
      .limit(1);
    const a = adoptRows[0];
    if (a?.consumedAt) adoptions = [{ id: a.id, adoptedAt: a.consumedAt.getTime(), heirName: a.heirName, houseName: a.houseName }];
  }

  // Births.
  const birthRows = await db
    .select({ id: children.id, bornAt: children.bornAt, childName: children.name, sex: children.sex })
    .from(children)
    .where(eq(children.parentCharacterId, slot.id));

  // The Megas Choregos win (this slot crowned the patron of a closed festival).
  const choregosRows = await db
    .select({
      id: festivalChoregos.id,
      closedAt: festivalChoregos.closedAt,
      festivalId: festivalChoregos.festivalId,
      gameYear: festivalChoregos.gameYear,
    })
    .from(festivalChoregos)
    .where(eq(festivalChoregos.winnerCharacterId, slot.id));

  // Festival participation: resolved festival cards where the character actively
  // engaged (not the auto-"attend"/"expired" outcome), excluding the Olympic cards.
  const festivalRows = await db
    .select({
      id: festivalEvents.id,
      createdAt: festivalEvents.createdAt,
      festivalId: festivalEvents.festivalId,
      gameYear: festivalEvents.gameYear,
      resolvedChoiceId: festivalEvents.resolvedChoiceId,
    })
    .from(festivalEvents)
    .where(
      and(
        eq(festivalEvents.characterId, slot.id),
        eq(festivalEvents.resolved, true),
        notInArray(festivalEvents.festivalId, [OLYMPIAD_NOMINATE_FESTIVAL_ID, OLYMPIAD_GAMES_FESTIVAL_ID]),
      ),
    );

  // A donation row for the instance means the character served as choregos (funded
  // it), versus a lighter form of participation.
  const donationRows = await db
    .select({ festivalId: festivalDonations.festivalId, gameYear: festivalDonations.gameYear })
    .from(festivalDonations)
    .where(eq(festivalDonations.characterId, slot.id));
  const donatedInstances = new Set(donationRows.map((d) => `${d.festivalId}:${d.gameYear}`));

  const festivals = festivalRows
    .filter((row) => row.resolvedChoiceId !== null && !NON_PARTICIPATION_CHOICES.includes(row.resolvedChoiceId))
    .map((row) => ({
      id: row.id,
      createdAt: row.createdAt.getTime(),
      festivalId: row.festivalId,
      gameYear: row.gameYear,
      choregos: donatedInstances.has(`${row.festivalId}:${row.gameYear}`),
    }));

  // Olympic selection: every nomination this slot stood for. "Sent" is the durable
  // signal — a Games card was delivered to the chosen delegate (the delegate trait
  // is stripped after the Games, so a live olympiadDelegates() check covers only the
  // in-flight window). nomination-only entries keep sent: false.
  const candidateRows = await db
    .select({ id: olympicCandidates.id, nominatedAt: olympicCandidates.nominatedAt, gameYear: olympicCandidates.olympiadGameYear })
    .from(olympicCandidates)
    .where(eq(olympicCandidates.characterId, slot.id));

  let olympics: ChronicleInput["olympics"] = [];
  if (candidateRows.length > 0) {
    const years = [...new Set(candidateRows.map((c) => c.gameYear))];
    // Durable "competed" record: Games cards delivered to this slot.
    const gamesRows = await db
      .select({ gameYear: festivalEvents.gameYear })
      .from(festivalEvents)
      .where(
        and(
          eq(festivalEvents.characterId, slot.id),
          eq(festivalEvents.festivalId, OLYMPIAD_GAMES_FESTIVAL_ID),
          inArray(festivalEvents.gameYear, years),
        ),
      );
    const sentYears = new Set(gamesRows.map((g) => g.gameYear));
    // Live window: this slot is currently a delegate for a not-yet-run Olympiad.
    for (const year of years) {
      if (sentYears.has(year)) continue;
      const delegates = await olympiadDelegates(year);
      if (delegates.some((d) => d.characterId === slot.id)) sentYears.add(year);
    }
    olympics = candidateRows.map((row) => ({
      id: row.id,
      nominatedAt: row.nominatedAt.getTime(),
      gameYear: row.gameYear,
      sent: sentYears.has(row.gameYear),
    }));
  }

  // Interaction Pipeline (Prompt 1): drachmae this slot RECEIVED from other
  // players. The actor's display name + house come from the players join (the
  // same pattern chamberView uses: player_characters → players for the name).
  const actorCharacters = alias(playerCharacters, "actor_characters");
  const giftRows = await db
    .select({
      id: interactions.id,
      createdAt: interactions.createdAt,
      payload: interactions.payload,
      actorName: players.name,
      houseName: houses.name,
    })
    .from(interactions)
    .innerJoin(actorCharacters, eq(actorCharacters.id, interactions.actorCharacterId))
    .innerJoin(players, eq(players.id, actorCharacters.playerId))
    .leftJoin(houses, eq(houses.slug, actorCharacters.houseSlug))
    .where(and(eq(interactions.targetCharacterId, slot.id), eq(interactions.type, "give")));

  const gifts = giftRows.map((row) => ({
    id: row.id,
    sentAt: row.createdAt.getTime(),
    actorName: row.actorName,
    houseName: row.houseName ?? "—",
    amount: Number((row.payload as { amount?: unknown }).amount ?? 0),
  }));

  // Hostile-channel chronicle lines targeting this slot (Prompts 2 & 3). All
  // anonymous — no actor surfaced. Poison illness onsets ('ill') + cures ('treat')
  // + survived assassinations (assassinate 'failed'). Excluded by design: poison/
  // assassination DEATH (succession is the announcement) and poison FAILURE (no
  // target-visible record — only the actor learns a poison failed).
  const afflictionRows = await db
    .select({ id: interactions.id, createdAt: interactions.createdAt, type: interactions.type, payload: interactions.payload })
    .from(interactions)
    .where(and(eq(interactions.targetCharacterId, slot.id), inArray(interactions.type, ["poison", "treat", "assassinate"])));

  const afflictions: ChronicleAfflictionRow[] = [];
  for (const row of afflictionRows) {
    const outcome = (row.payload as { outcome?: unknown }).outcome;
    if (row.type === "treat") {
      afflictions.push({ id: row.id, at: row.createdAt.getTime(), kind: "venom_purged" });
    } else if (row.type === "poison" && outcome === "ill") {
      afflictions.push({ id: row.id, at: row.createdAt.getTime(), kind: "poison_illness" });
    } else if (row.type === "assassinate" && outcome === "failed") {
      afflictions.push({ id: row.id, at: row.createdAt.getTime(), kind: "assassination_survived" });
    }
  }

  return buildChronicle({
    startedMs,
    successionBoundariesMs,
    marriages: marriageRows.map((row) => ({ id: row.id, marriedAt: row.marriedAt.getTime(), spouseName: row.spouseName, endedAt: row.endedAt ? row.endedAt.getTime() : null, endReason: row.endReason })),
    births: birthRows.map((row) => ({ id: row.id, bornAt: row.bornAt.getTime(), childName: row.childName, sex: row.sex })),
    choregos: choregosRows.map((row) => ({ id: row.id, closedAt: row.closedAt.getTime(), festivalId: row.festivalId, gameYear: row.gameYear })),
    festivals,
    olympics,
    adoptions,
    gifts,
    afflictions,
    deaths,
  });
}
