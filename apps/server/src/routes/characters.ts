import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import {
  characters,
  createDb,
  dynasties,
  houses,
  players,
  professions,
  resources,
  worlds,
} from "@massalia/db";
import { avatarById, hasLetter, sanitizeDisplayName, type ClassId } from "@massalia/shared";
import { requireAuth } from "../services/auth.js";
import { createCharacterRow, grantStartingPackage } from "../services/character.js";
import { getAgeConfig } from "../services/age.js";

const db = createDb();

type CharacterPayload = {
  classSlug?: string;
  houseSlug?: string;
  faceIndex?: number;
  avatarId?: string;
  name?: string;
};

// Mirror of the map in routes/me.ts — keep in sync. Real goods for producing
// classes (grain/wine/herbal/ship); a stat for the income-only/stat classes
// (the client only renders the class-store row for real goods).
const classResourceByProfession: Record<string, string | null> = {
  landowner: "grain",
  trader: "wine",
  priest: "herbal",
  philosopher: "prestige",
  shipbuilder: "ship",
  hetaira: "intelligence",
  hoplite: "militia",
  slave: "freedom",
};

// Character names: sanitised (control / zero-width / bidi characters stripped,
// whitespace collapsed, 64 chars) and required to carry at least one letter;
// unique per world case-insensitively among active players (migration 0050).
const NAME_NEEDS_LETTER = "A character name needs at least one letter.";
const NAME_TAKEN = "That name is already taken in this world. Choose another.";

// A unique-index violation on the name index (drizzle wraps the pg error as `cause`).
function isNameConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string } | undefined;
  return pgError?.code === "23505" && pgError.constraint === "players_name_world_lower_idx";
}

function faceFromPayload(payload: CharacterPayload) {
  if (typeof payload.avatarId === "string" && payload.avatarId.trim()) {
    return payload.avatarId.trim().slice(0, 80);
  }
  if (typeof payload.faceIndex === "number" && Number.isInteger(payload.faceIndex)) {
    return String(payload.faceIndex);
  }
  return "";
}

async function getActiveWorld() {
  const rows = await db.select().from(worlds).where(eq(worlds.status, "active")).limit(1);
  const world = rows[0];
  if (!world) {
    const error = new Error("No active world exists. Run db:seed first.");
    (error as Error & { statusCode?: number }).statusCode = 503;
    throw error;
  }
  return world;
}

async function assertCatalog(payload: CharacterPayload) {
  const classSlug = typeof payload.classSlug === "string" ? payload.classSlug.trim() : "";
  const houseSlug = typeof payload.houseSlug === "string" ? payload.houseSlug.trim() : "";
  const professionRows = await db.select().from(professions).where(eq(professions.slug, classSlug)).limit(1);
  const houseRows = await db.select().from(houses).where(eq(houses.slug, houseSlug)).limit(1);
  const profession = professionRows[0];
  const house = houseRows[0];
  if (!profession || !house) {
    const error = new Error("Invalid profession or House selection.");
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return { profession, house };
}

export async function characterRoutes(app: FastifyInstance) {
  app.post("/", async (request, reply) => {
    const user = await requireAuth(request);
    const payload = request.body as CharacterPayload;
    const name = sanitizeDisplayName(payload.name);
    const faceId = faceFromPayload(payload);
    if (!name || !faceId) {
      reply.code(400);
      return { error: "Character name and face are required." };
    }
    if (!hasLetter(name)) {
      reply.code(400);
      return { error: NAME_NEEDS_LETTER };
    }
    // Age pack: the avatar must be one of the configured age avatars (it fixes
    // the start age 20/30 and the start bonus).
    if (!avatarById(faceId, getAgeConfig())) {
      reply.code(400);
      return { error: "Choose a valid starting avatar." };
    }

    const world = await getActiveWorld();
    const { profession, house } = await assertCatalog(payload);
    const existing = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.worldId, world.id), eq(players.userId, user.id), eq(players.isActive, true)))
      .limit(1);
    if (existing[0]) {
      reply.code(409);
      return { error: "You already have an active character in this world." };
    }
    // Friendly pre-check; the unique index inside the transaction is the guarantee.
    const taken = await db
      .select({ id: players.id })
      .from(players)
      .where(and(eq(players.worldId, world.id), eq(players.isActive, true), sql`lower(${players.name}) = lower(${name})`))
      .limit(1);
    if (taken[0]) {
      reply.code(409);
      return { error: NAME_TAKEN };
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
      const dynasty = (await tx.insert(dynasties).values({ worldId: world.id, name: `${name} Household`, prestige: 0 }).returning())[0]!;
      const player = (await tx
        .insert(players)
        .values({
          worldId: world.id,
          userId: user.id,
          name,
          color: "#b58a45",
          professionSlug: profession.slug,
          houseSlug: house.slug,
          faceId,
          party: "unaligned",
          origin: "Massalia",
        })
        .returning())[0]!;
      const character = (await tx
        .insert(characters)
        .values({
          dynastyId: dynasty.id,
          playerId: player.id,
          name,
          professionSlug: profession.slug,
          houseSlug: house.slug,
          faceId,
          party: "unaligned",
          origin: "Massalia",
          birthTick: 0,
        })
        .returning())[0]!;

      // The wallet lives on player_characters.drachmae, NOT the resources table —
      // no phantom currency row is seeded. Seed prestige/influence, plus the class
      // resource only when the profession has one (shipbuilder has none).
      const classResource: string | null = profession.slug in classResourceByProfession ? classResourceByProfession[profession.slug] ?? null : "favor";
      const startingResources = new Map<string, string>([
        ["prestige", "0"],
        ["influence", "0"],
      ]);
      if (classResource) startingResources.set(classResource, "0");
      await tx.insert(resources).values(
        Array.from(startingResources, ([type, amount]) => ({
          scope: "player",
          scopeId: player.id,
          type,
          amount,
          ratePerSecond: "0",
          lastUpdatedAt: new Date(),
        })),
      );

      // Starting package (free classes only): 10 wheat + 1 slave.
      await grantStartingPackage(tx, player.id, world.id, profession.slug as ClassId);

      return { player, character };
      });
    } catch (error) {
      if (isNameConflict(error)) {
        reply.code(409);
        return { error: NAME_TAKEN };
      }
      throw error;
    }

    // Provision the canonical character sheet (stats, ideology, party, currency,
    // age) so /api/character and the HUD work immediately. The chosen avatar
    // fixes the start age + start bonus.
    await createCharacterRow(result.player.id, world.id, house.slug, profession.slug as ClassId, faceId);

    reply.code(201);
    return result;
  });
}
