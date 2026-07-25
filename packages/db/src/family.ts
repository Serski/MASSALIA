import { and, eq, isNull } from "drizzle-orm";
import {
  adoptionWomenOnly,
  applyStatGrowth,
  canMarry,
  candidateTrait,
  capStat,
  childRoll,
  defaultChildName,
  generateCandidates,
  isFamilyLocked,
  isFertile,
  LOVER_DISCOVERY_CHANCE,
  LOVER_DISCOVERY_PRESTIGE,
  loverFallChance,
  spouseCurrentAge,
  clytemnestraSuccessChance,
  tragedyArchetype,
  TRAGEDY_PHILIA_THRESHOLD,
  TRAGEDY_YEARLY_CHANCE,
  type AgeConfig,
  type FamilyConfig,
} from "@massalia/shared";
import { createDb } from "./client.js";
import { children, composureLog, effectLog, familyCandidates, houses, marriages, playerCharacters } from "./schema.js";

const db = createDb();

export type FamilyCandidateRow = typeof familyCandidates.$inferSelect;

type DrawArgs = { familyCfg: FamilyConfig; ageCfg: AgeConfig; now?: Date };

// Draw a fresh per-player candidate set. Used by BOTH the BullMQ worker
// (scheduled yearly) and the server (lazy-on-read), like resolveCensureIfExpired.
// New draws REPLACE the character's unconsumed candidates of that purpose so the
// offer stays fresh; consumed (chosen) rows are left for history.
//
// Prompt A surfaces marriage candidates for unmarried citizens, and women-only
// adoption candidates for the hetaira (her only family path). Citizen adoption +
// children/heirs arrive with the succession pack.
export async function drawFamilyCandidates(characterId: string, args: DrawArgs): Promise<FamilyCandidateRow[]> {
  const { familyCfg, ageCfg } = args;
  const charRows = await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1);
  const character = charRows[0];
  if (!character) return [];
  if (isFamilyLocked(character.classId, familyCfg)) return []; // slave: nothing is drawn

  const houseRows = await db.select({ slug: houses.slug, ideology: houses.startIdeology }).from(houses);
  // Pool avatars by draw pool, not sex — wives and hetairai are both female, so a
  // marriage candidate (always female) must draw only from the "wife" pool, never a
  // hetaira player-face. Male picks use the "player" pool. Fall back to "player" if
  // the wanted pool is empty (keeps working before a pool's art lands).
  const avatarsByPool = { player: [] as string[], wife: [] as string[], hetaira: [] as string[] };
  for (const a of ageCfg.avatars) (avatarsByPool[a.pool] ?? avatarsByPool.player).push(a.id);
  const pickAvatarFor = (sex: "male" | "female") => {
    const wanted = sex === "female" ? avatarsByPool.wife : avatarsByPool.player;
    const pool = wanted.length ? wanted : avatarsByPool.player;
    return pool.length ? pool[Math.floor(Math.random() * pool.length)]! : null;
  };

  const purposes: { purpose: "marriage" | "adoption"; count: number; womenOnly: boolean }[] = [];
  if (canMarry(character.classId, familyCfg) && !character.spouseCandidateId) {
    purposes.push({ purpose: "marriage", count: familyCfg.candidates.perDraw, womenOnly: false });
  }
  if (character.classId === "hetaira") {
    purposes.push({ purpose: "adoption", count: familyCfg.adoption.perDraw, womenOnly: adoptionWomenOnly(character.classId, familyCfg) });
  }

  const inserted: FamilyCandidateRow[] = [];
  for (const { purpose, count, womenOnly } of purposes) {
    const drafts = generateCandidates(Math.random, purpose, count, familyCfg, houseRows, womenOnly);
    // Replace this purpose's unconsumed offers with the fresh draw.
    await db
      .delete(familyCandidates)
      .where(and(eq(familyCandidates.forCharacterId, characterId), eq(familyCandidates.purpose, purpose), isNull(familyCandidates.consumedAt)));
    for (const draft of drafts) {
      const rows = await db
        .insert(familyCandidates)
        .values({
          worldId: character.worldId,
          forCharacterId: characterId,
          purpose: draft.purpose,
          name: draft.name,
          sex: draft.sex,
          houseSlug: draft.houseSlug,
          age: draft.age,
          prestige: draft.prestige,
          devotion: draft.devotion,
          militia: draft.militia,
          intelligence: draft.intelligence,
          traitId: draft.traitId,
          personalityTraitId: draft.personalityTraitId,
          avatarId: pickAvatarFor(draft.sex),
          ideology: draft.ideology,
        })
        .returning();
      inserted.push(rows[0]!);
    }
  }
  return inserted;
}

export type ChildRow = typeof children.$inferSelect;
export type ChildBirth = { child: ChildRow; motherDied: boolean; lateWifeName: string | null };

// The yearly child roll, with lazy catch-up. Mirrors the candidate cadence and
// the composure/decay lazy-on-read model: rolls once per game year elapsed since
// last_child_roll_at (capped), advancing the anchor. Called by BOTH the BullMQ
// worker (scheduled) and the server (lazy-on-read). Births insert a child with a
// default name (named=false -> the birth event awaits naming). If the mother dies
// the marriage ends ('death_in_childbirth') and the spouse link clears, but the
// child survives — the widower may remarry from future draws.
export async function rollChildrenDue(
  characterId: string,
  // `rng` drives the lover fall/discovery rolls only (default Math.random);
  // `tragedyRng` drives the tragedy trigger + Clytemnestra success rolls; the
  // child roll keeps its own Math.random.
  args: { familyCfg: FamilyConfig; ageCfg: AgeConfig; now?: Date; rng?: () => number; tragedyRng?: () => number },
): Promise<ChildBirth[]> {
  const { familyCfg, ageCfg } = args;
  const now = args.now ?? new Date();
  const gameYearMs = ageCfg.realMsPerGameYear;
  const loverRng = args.rng ?? Math.random;
  const tragedyRng = args.tragedyRng ?? Math.random;

  const load = async () => (await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0];
  let character = await load();
  if (!character || !character.spouseCandidateId || isFamilyLocked(character.classId, familyCfg)) return [];

  // Initialise the anchor for a freshly married / legacy row.
  if (!character.lastChildRollAt) {
    await db.update(playerCharacters).set({ lastChildRollAt: now }).where(eq(playerCharacters.id, characterId));
    return [];
  }

  const anchorStart = character.lastChildRollAt;
  const years = Math.floor((now.getTime() - anchorStart.getTime()) / gameYearMs);
  if (years <= 0) return [];
  const rolls = Math.min(years, familyCfg.children.maxChildren + 2); // catch-up cap

  const births: ChildBirth[] = [];
  for (let i = 0; i < rolls; i++) {
    character = await load();
    // Widowed OR dead (a Clytemnestra success in an earlier catch-up year) -> stop:
    // no more rolls until a living character remarries.
    if (!character || character.status !== "alive" || !character.spouseCandidateId) break;
    // "That year's" roll timestamp — anchors the lover fell/discovered notices.
    const yearTimestamp = new Date(anchorStart.getTime() + (i + 1) * gameYearMs);

    const spouseRows = await db.select().from(familyCandidates).where(eq(familyCandidates.id, character.spouseCandidateId)).limit(1);
    const spouse = spouseRows[0];
    const spouseTrait = candidateTrait(familyCfg, spouse?.traitId ?? null);

    // The active marriage — philia + lover-plot state. Read ABOVE the fertility
    // gate so the lover/tragedy rolls fire every year regardless of the fertility window.
    const marriageRows = await db
      .select({ id: marriages.id, philia: marriages.philia, loverState: marriages.loverState, loverDiscoveredAt: marriages.loverDiscoveredAt, loverStartedAt: marriages.loverStartedAt })
      .from(marriages)
      .where(and(eq(marriages.characterId, characterId), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)))
      .limit(1);
    const marriage = marriageRows[0];
    const philia = marriage?.philia ?? 50;
    let loverState = marriage?.loverState ?? "none";
    let loverDiscovered = marriage?.loverDiscoveredAt != null;

    // --- Tragedy roll (ABOVE the lover rolls: the terminal act outranks the plot) ---
    // An estranged marriage (philia <= threshold) risks, each year, a fatal act by
    // the wife, resolved by her personality. On ANY tragedy we resolve and break: the
    // marriage is over, so no lover roll, fertility gate, or child insert may run this
    // iteration or after (R2 belt-one). All timestamps use `now` (execution time) so
    // notice windows are correct even during multi-year catch-up.
    if (marriage && philia <= TRAGEDY_PHILIA_THRESHOLD && tragedyRng() < TRAGEDY_YEARLY_CHANCE) {
      const char = character; // narrow non-null for the closures below
      const living = await db
        .select({ id: children.id })
        .from(children)
        .where(and(eq(children.parentCharacterId, characterId), isNull(children.diedAt)));
      const archetype = tragedyArchetype({
        personalityId: spouse?.personalityTraitId ?? null,
        loverPlotWasRun: marriage.loverStartedAt != null,
        hasLivingChildren: living.length > 0,
      });

      // All three: the wife dies — end the marriage (the wife-death shape: ended_at +
      // reason + cleared spouse link) and log the tragedy.
      const endMarriage = async (endReason: string) => {
        await db.update(marriages).set({ endedAt: now, endReason }).where(eq(marriages.id, marriage.id));
        await db.update(playerCharacters).set({ spouseCandidateId: null }).where(eq(playerCharacters.id, characterId));
        await db.insert(effectLog).values({ characterId, kind: "tragedy", detail: { archetype } });
      };
      // Composure penalty, clamped to the floor (the merc db idiom: never below 0).
      const hitComposure = async (amount: number) => {
        const drop = Math.min(char.composure, amount);
        await db.update(playerCharacters).set({ composure: char.composure - drop }).where(eq(playerCharacters.id, characterId));
        await db.insert(composureLog).values({ characterId, delta: -drop, reason: `tragedy:${archetype}` });
      };
      // Negative prestige, floored (the lover-discovery db idiom; applyStatGrowth
      // passes penalties through unscaled, capStat applies the floor).
      const hitPrestige = async (amount: number) => {
        const applied = applyStatGrowth(amount, Number(char.growthMultiplier));
        const next = capStat(char.prestige + applied, ageCfg);
        await db.update(playerCharacters).set({ prestige: next }).where(eq(playerCharacters.id, characterId));
        await db.insert(effectLog).values({ characterId, kind: "change_stat", detail: { stat: "prestige", requested: amount, applied, source: `tragedy:${archetype}` } });
      };

      if (archetype === "medea") {
        // She takes the children with her: mark every living child dead. Phase 1's
        // filters make the childless aftermath (forced_adoption/regency) correct.
        await db.update(children).set({ diedAt: now }).where(and(eq(children.parentCharacterId, characterId), isNull(children.diedAt)));
        await endMarriage("tragedy_medea");
        await hitComposure(70);
        await hitPrestige(-5);
      } else if (archetype === "clytemnestra") {
        const success = tragedyRng() < clytemnestraSuccessChance(char.militia);
        await endMarriage("tragedy_clytemnestra");
        if (success) {
          // The player dies. The merc-style direct status flip; the status-keyed
          // succession flow takes over unmodified. The dead take no composure/prestige.
          await db.update(playerCharacters).set({ status: "deceased" }).where(eq(playerCharacters.id, characterId));
        } else {
          // Discovered, she takes her own life.
          await hitComposure(30);
          await hitPrestige(-2);
        }
      } else {
        // Phaedra: she alone dies.
        await endMarriage("tragedy_phaedra");
        await hitComposure(40);
        await hitPrestige(-2);
      }
      break; // terminal — no further catch-up years are processed
    }

    // --- Lover plot yearly rolls (piggybacked on the child cadence) ---------
    if (loverState !== "none" && marriage) {
      // Fall roll — only while active. Fallen is permanent (no further fall rolls).
      if (loverState === "active" && loverRng() < loverFallChance(spouse?.personalityTraitId ?? null)) {
        loverState = "fallen";
        await db.update(marriages).set({ loverState: "fallen", loverFellAt: yearTimestamp }).where(eq(marriages.id, marriage.id));
        await db.insert(effectLog).values({ characterId, kind: "lover_plot", detail: { action: "fell" } });
      }
      // Discovery roll — active AND fallen years both risk it, at most once.
      if (!loverDiscovered && loverRng() < LOVER_DISCOVERY_CHANCE) {
        loverDiscovered = true;
        const applied = applyStatGrowth(LOVER_DISCOVERY_PRESTIGE, Number(character.growthMultiplier));
        const nextPrestige = capStat(character.prestige + applied, ageCfg);
        await db.update(marriages).set({ loverDiscoveredAt: yearTimestamp }).where(eq(marriages.id, marriage.id));
        await db.update(playerCharacters).set({ prestige: nextPrestige }).where(eq(playerCharacters.id, characterId));
        await db.insert(effectLog).values({ characterId, kind: "lover_plot", detail: { action: "discovered" } });
        await db.insert(effectLog).values({ characterId, kind: "change_stat", detail: { stat: "prestige", requested: LOVER_DISCOVERY_PRESTIGE, applied, source: "lover_plot:discovered" } });
      }
    }
    const plotActive = loverState !== "none";

    // Fertility window: outside [from, to] no roll fires — the marriage simply
    // bears no more children (it continues; she may yet die of old age later).
    if (spouse) {
      const wifeAge = spouseCurrentAge(spouse.age, spouse.createdAt.getTime(), now.getTime(), gameYearMs);
      if (!isFertile(wifeAge, familyCfg)) continue;
    }

    const existing = await db.select({ id: children.id }).from(children).where(and(eq(children.parentCharacterId, characterId), isNull(children.diedAt)));
    const outcome = childRoll(Math.random, { active: true }, existing.length, spouseTrait, familyCfg, philia, plotActive);
    if (!outcome.born) continue;

    const inserted = (await db
      .insert(children)
      .values({ parentCharacterId: characterId, worldId: character.worldId, name: defaultChildName(outcome.sex), sex: outcome.sex, bornAt: now, named: false, rumor: plotActive })
      .returning())[0]!;

    let lateWifeName: string | null = null;
    if (outcome.motherDied) {
      lateWifeName = spouseRows[0]?.name ?? null;
      // End the active marriage (the child survives) and free the widower to remarry.
      await db
        .update(marriages)
        .set({ endedAt: now, endReason: "death_in_childbirth" })
        .where(and(eq(marriages.characterId, characterId), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)));
      await db.update(playerCharacters).set({ spouseCandidateId: null }).where(eq(playerCharacters.id, characterId));
    }
    births.push({ child: inserted, motherDied: outcome.motherDied, lateWifeName });
  }

  // Consume the elapsed years on the anchor (preserve sub-year remainder).
  await db.update(playerCharacters).set({ lastChildRollAt: new Date(anchorStart.getTime() + years * gameYearMs) }).where(eq(playerCharacters.id, characterId));
  return births;
}

// --- Spouse death of old age -----------------------------------------------

export type SpouseDeath = { characterId: string; lateWifeName: string | null; yearsMarried: number };

type SpouseArgs = { familyCfg: FamilyConfig; ageCfg: AgeConfig; now?: Date };

// End one active marriage if the wife has reached her rolled death age: stamp
// ended_at/end_reason='spouse_died' and clear the character's spouse link so the
// yearly marriage-candidate draws re-open. Returns the death (for a notice) or null.
// Shared by the server (lazy-on-read) and the worker sweep, like the child roll.
export async function checkSpouseDeath(characterId: string, args: SpouseArgs): Promise<SpouseDeath | null> {
  const now = args.now ?? new Date();
  const gameYearMs = args.ageCfg.realMsPerGameYear;

  const character = (await db.select().from(playerCharacters).where(eq(playerCharacters.id, characterId)).limit(1))[0];
  if (!character || !character.spouseCandidateId) return null;

  const marriage = (
    await db
      .select()
      .from(marriages)
      .where(and(eq(marriages.characterId, characterId), eq(marriages.candidateId, character.spouseCandidateId), isNull(marriages.endedAt)))
      .limit(1)
  )[0];
  if (!marriage || marriage.spouseDeathAge === null) return null;

  const spouse = (await db.select().from(familyCandidates).where(eq(familyCandidates.id, character.spouseCandidateId)).limit(1))[0];
  if (!spouse) return null;

  const wifeAge = spouseCurrentAge(spouse.age, spouse.createdAt.getTime(), now.getTime(), gameYearMs);
  if (wifeAge < marriage.spouseDeathAge) return null;

  // She has died of old age — end the marriage and free the widower to remarry.
  await db.update(marriages).set({ endedAt: now, endReason: "spouse_died" }).where(eq(marriages.id, marriage.id));
  await db.update(playerCharacters).set({ spouseCandidateId: null }).where(eq(playerCharacters.id, characterId));

  const yearsMarried = Math.max(0, Math.floor((now.getTime() - marriage.marriedAt.getTime()) / gameYearMs));
  return { characterId, lateWifeName: spouse.name, yearsMarried };
}

// The global belt-and-suspenders sweep (the worker's scheduled path, mirroring
// the festival sweep): end every active marriage whose wife has died of old age.
export async function sweepSpouseDeaths(args: SpouseArgs): Promise<SpouseDeath[]> {
  const now = args.now ?? new Date();
  const married = await db
    .select({ id: playerCharacters.id })
    .from(playerCharacters)
    .innerJoin(marriages, and(eq(marriages.characterId, playerCharacters.id), isNull(marriages.endedAt)))
    .where(eq(playerCharacters.status, "alive"));

  const deaths: SpouseDeath[] = [];
  for (const row of married) {
    const death = await checkSpouseDeath(row.id, { ...args, now });
    if (death) deaths.push(death);
  }
  return deaths;
}
