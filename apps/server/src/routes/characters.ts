import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
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
import { requireAuth } from "../services/auth.js";

const db = createDb();

type CharacterPayload = {
  classSlug?: string;
  houseSlug?: string;
  faceIndex?: number;
  avatarId?: string;
  name?: string;
};

const classResourceByProfession: Record<string, string> = {
  landowner: "wheat",
  trader: "wine",
  priest: "herbal",
  philosopher: "prestige",
  shipbuilder: "gold",
  hetaira: "intelligence",
  "military-leader": "militia",
  slave: "freedom",
};

function sanitizeName(name: unknown) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/\s+/g, " ").slice(0, 64);
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
    const name = sanitizeName(payload.name);
    const faceId = faceFromPayload(payload);
    if (!name || !faceId) {
      reply.code(400);
      return { error: "Character name and face are required." };
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

    const result = await db.transaction(async (tx) => {
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

      const classResource = classResourceByProfession[profession.slug] ?? "favor";
      const startingResources = new Map([
        ["gold", "100"],
        ["prestige", "0"],
        ["influence", "0"],
        [classResource, classResource === "gold" ? "100" : "0"],
      ]);
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

      return { player, character };
    });

    reply.code(201);
    return result;
  });
}
