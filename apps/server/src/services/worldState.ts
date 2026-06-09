import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVER_DURATION_DAYS, type MapGameState, type ProvinceState } from "@massalia/shared";

type Listener = () => void | Promise<void>;

const listeners = new Set<Listener>();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");
const geojsonPath = path.join(repoRoot, "content/map/provinces.geojson");

const owners = [
  { id: "player-phocaean", name: "House Phocaean", color: "#2f80ed", factionId: "faction-blue", factionColor: "#3a86ff" },
  { id: "player-aurelian", name: "Aurelian League", color: "#c44d58", factionId: "faction-red", factionColor: "#d1495b" },
] as const;
const firstOwner = owners[0];
const secondOwner = owners[1];

const dynamicOwners = new Map<string, string>();

interface ProvinceGeoJson {
  features: Array<{
    properties: { id: string; name: string; regionId: string; realmId: string };
  }>;
}

export async function getWorldState(): Promise<MapGameState> {
  const content = JSON.parse(await fs.readFile(geojsonPath, "utf8")) as ProvinceGeoJson;
  const provinces: Record<string, ProvinceState> = {};

  content.features.forEach((feature, index) => {
    const ownerId = dynamicOwners.get(feature.properties.id) ?? (index < 7 ? firstOwner.id : secondOwner.id);
    const owner = owners.find((candidate) => candidate.id === ownerId) ?? firstOwner;
    provinces[feature.properties.id] = {
      id: feature.properties.id,
      worldId: "world-massalia-season-one",
      name: feature.properties.name,
      regionId: feature.properties.regionId,
      realmId: feature.properties.realmId,
      terrain: terrainFor(index),
      ownerPlayerId: owner.id,
      ownerName: owner.name,
      factionId: owner.factionId,
      factionColor: owner.factionColor,
      politicalColor: owner.color,
      controlStatus: index === 8 ? "contested" : "controlled",
      isCity: ["massalia-harbor", "aix", "arles", "brignoles", "toulon"].includes(feature.properties.id),
      buildings: buildingsFor(feature.properties.id),
      resources: resourcesFor(feature.properties.id),
    };
  });

  return {
    world: {
      id: "world-massalia-season-one",
      name: "Massalia Season One",
      seed: "massalia-alpha",
      startedAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + SERVER_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      status: "active",
    },
    provinces,
  };
}

export async function getProvinceDetail(provinceId: string) {
  const state = await getWorldState();
  return state.provinces[provinceId] ?? null;
}

export function setProvinceOwner(provinceId: string, ownerPlayerId: string) {
  dynamicOwners.set(provinceId, ownerPlayerId);
  void broadcastState();
}

export function resolveOwnerToken(ownerPlayerId: string) {
  if (ownerPlayerId === "FIRST_PLAYER") return firstOwner.id;
  if (ownerPlayerId === "SECOND_PLAYER") return secondOwner.id;
  return ownerPlayerId;
}

export function subscribeState(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function broadcastState() {
  await Promise.all([...listeners].map((listener) => listener()));
}

function terrainFor(index: number) {
  return ["plains", "coast", "coast", "farmland", "marsh", "marsh", "hills", "mountain", "forest", "coast", "farmland", "hills"][index] ?? "plains";
}

function buildingsFor(provinceId: string) {
  if (provinceId === "massalia-harbor") return [{ type: "harbor", level: 2, queuedCompletionAt: null }];
  if (provinceId === "aix") return [{ type: "market", level: 1, queuedCompletionAt: null }];
  if (provinceId === "brignoles") return [{ type: "watchtower", level: 1, queuedCompletionAt: new Date(Date.now() + 60_000).toISOString() }];
  return [];
}

function resourcesFor(provinceId: string) {
  const lastUpdatedAt = new Date().toISOString();
  if (provinceId === "massalia-harbor") return [{ type: "grain", amount: 240, ratePerSecond: 0.05, lastUpdatedAt }];
  if (provinceId === "aix") return [{ type: "silver", amount: 80, ratePerSecond: 0.01, lastUpdatedAt }];
  if (provinceId === "brignoles") return [{ type: "timber", amount: 130, ratePerSecond: 0.03, lastUpdatedAt }];
  return [];
}
