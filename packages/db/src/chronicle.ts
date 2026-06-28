import { and, eq, inArray, notInArray } from "drizzle-orm";
import {
  buildChronicle,
  OLYMPIAD_GAMES_FESTIVAL_ID,
  type ChronicleEntry,
  type ChronicleInput,
} from "@massalia/shared";
import { createDb } from "./client.js";
import {
  children,
  familyCandidates,
  festivalChoregos,
  festivalDonations,
  festivalEvents,
  marriages,
  olympicCandidates,
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
      .select({ id: playerCharacters.id, dynastyId: playerCharacters.dynastyId })
      .from(playerCharacters)
      .where(eq(playerCharacters.id, characterId))
      .limit(1)
  )[0];
  if (!slot) return [];

  const startedMs = await worldStartedMs();
  if (startedMs === null) return [];

  // Succession instants for this dynasty mark the generation handoffs.
  const successionBoundariesMs = slot.dynastyId
    ? (
        await db
          .select({ occurredAt: successions.occurredAt })
          .from(successions)
          .where(eq(successions.dynastyId, slot.dynastyId))
      ).map((row) => row.occurredAt.getTime())
    : [];

  // Marriages (spouse display name via the consumed family candidate).
  const marriageRows = await db
    .select({ id: marriages.id, marriedAt: marriages.marriedAt, spouseName: familyCandidates.name })
    .from(marriages)
    .innerJoin(familyCandidates, eq(familyCandidates.id, marriages.candidateId))
    .where(eq(marriages.characterId, slot.id));

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

  return buildChronicle({
    startedMs,
    successionBoundariesMs,
    marriages: marriageRows.map((row) => ({ id: row.id, marriedAt: row.marriedAt.getTime(), spouseName: row.spouseName })),
    births: birthRows.map((row) => ({ id: row.id, bornAt: row.bornAt.getTime(), childName: row.childName, sex: row.sex })),
    choregos: choregosRows.map((row) => ({ id: row.id, closedAt: row.closedAt.getTime(), festivalId: row.festivalId, gameYear: row.gameYear })),
    festivals,
    olympics,
  });
}
