import { z } from "zod";

// ---------------------------------------------------------------------------
// Barracks — trained UNITS (raised from the player's own levy, paid in raw
// materials) and hired BANDS (mercenary companies on a seasonal contract, paid
// in drachmae per band per day). Server-side content only: nothing here is ever
// copied under apps/web/public; the client sees definitions solely through the
// /api/barracks response.
//
// Unrelated to military.ts: that file is the Hoplite's PERSONAL rank ladder and
// foreign contracts. This is the player's army.
//
// Good ids (gear + upkeep) are validated against a caller-supplied list — the
// vendor band in content/buildings/buildings.json is the source of truth, and
// the server loader passes its keys in. `drachmae` is additionally allowed in
// band upkeep only (a band's pay), never as gear or trained upkeep.
// ---------------------------------------------------------------------------

export const UNIT_ROLES = ["line", "skirmish", "missile", "mounted"] as const;
export type UnitRole = (typeof UNIT_ROLES)[number];

// Ships (content/military/ships.json). Players own no pentekonters or triremes
// of their own: their hulls are the `trade-ship` (pentekonter role) and `galley`
// (trireme role) goods, so every ship id must be a vendor good. `range` is sea
// provinces from a base's coast, `troopSpace` the force space one hull carries,
// `naval` its fighting weight (unused until the battle resolver).
export const SHIP_ROLES = ["transport", "warship"] as const;
export type ShipRole = (typeof SHIP_ROLES)[number];
export type ShipDef = { label: string; role: ShipRole; range: number; troopSpace: number; naval: number };
export type ShipsContent = { version: number; source: string; ships: Record<string, ShipDef> };

export type UnitStats = { atk: number; def: number; msl: number; mor: number; spd: number; space: number };

export type UnitDef = {
  label: string;
  icon: string; // filename under apps/web/public/assets/, resolved by the tab
  role: UnitRole;
  trainSeasons: number;
  gear: Record<string, number>; // per man, paid once on recruit
  upkeepPerDay: Record<string, number>; // per man, per in-game day
  stats: UnitStats; // per man
};

export type LevyConfig = { startMen: number; growthPerYear: number; seasonsPerYear: number };

export type UnitsContent = {
  version: number;
  source: string;
  gate: { militia: number };
  levy: LevyConfig;
  minServiceSeasons: number;
  units: Record<string, UnitDef>;
};

export type BandDef = {
  label: string;
  icon: string;
  role: UnitRole;
  men: number;
  renew?: number; // probability of a renewal offer at contract end; contract.renewDefault when absent
  upkeepPerDay: Record<string, number>; // per BAND (not per man); may include "drachmae"
  stats: UnitStats; // per man
};

export type BandsContent = {
  version: number;
  source: string;
  market: { offersPerSeason: number; maxActiveBands: number };
  contract: { termSeasons: number; renewDefault: number };
  bands: Record<string, BandDef>;
};

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const stat = z.number().int().min(0).max(10);

const statsSchema = z
  .object({
    atk: stat,
    def: stat,
    msl: stat,
    mor: stat,
    spd: stat,
    space: z.union([z.literal(1), z.literal(3)]),
  })
  .strict();

// A good → quantity map whose keys must all be in `allowed`.
function goodsSchema(allowed: ReadonlySet<string>, what: string) {
  return z.record(z.string(), z.number().int().positive()).superRefine((map, ctx) => {
    for (const good of Object.keys(map)) {
      if (!allowed.has(good)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what}: unknown good "${good}"` });
    }
  });
}

function kebabKeys(what: string) {
  return (map: Record<string, unknown>, ctx: z.RefinementCtx) => {
    for (const id of Object.keys(map)) {
      if (!KEBAB.test(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${what} id "${id}" must be kebab-case` });
    }
  };
}

function unitsContentSchema(goods: ReadonlySet<string>) {
  const unitSchema = z
    .object({
      label: z.string().min(1),
      icon: z.string().min(1),
      role: z.enum(UNIT_ROLES),
      trainSeasons: z.number().int().nonnegative(),
      gear: goodsSchema(goods, "gear"),
      upkeepPerDay: goodsSchema(goods, "upkeepPerDay"),
      stats: statsSchema,
    })
    .strict();
  return z
    .object({
      version: z.number().int().positive(),
      source: z.string(),
      gate: z.object({ militia: z.number().int().nonnegative() }).strict(),
      levy: z
        .object({
          startMen: z.number().int().nonnegative(),
          growthPerYear: z.number().int().nonnegative(),
          seasonsPerYear: z.number().int().positive(),
        })
        .strict(),
      minServiceSeasons: z.number().int().nonnegative(),
      units: z.record(z.string(), unitSchema).superRefine(kebabKeys("unit")),
    })
    .strict();
}

function bandsContentSchema(goods: ReadonlySet<string>) {
  const upkeepGoods = new Set([...goods, "drachmae"]);
  const bandSchema = z
    .object({
      label: z.string().min(1),
      icon: z.string().min(1),
      role: z.enum(UNIT_ROLES),
      men: z.number().int().min(10).max(40),
      renew: z.number().min(0).max(1).optional(),
      upkeepPerDay: goodsSchema(upkeepGoods, "upkeepPerDay"),
      stats: statsSchema,
    })
    .strict();
  return z
    .object({
      version: z.number().int().positive(),
      source: z.string(),
      market: z.object({ offersPerSeason: z.number().int().positive(), maxActiveBands: z.number().int().nonnegative() }).strict(),
      contract: z.object({ termSeasons: z.number().int().positive(), renewDefault: z.number().min(0).max(1) }).strict(),
      bands: z.record(z.string(), bandSchema).superRefine(kebabKeys("band")),
    })
    .strict();
}

function shipsContentSchema(goods: ReadonlySet<string>) {
  const shipSchema = z
    .object({
      label: z.string().min(1),
      role: z.enum(SHIP_ROLES),
      range: z.number().int().positive(),
      troopSpace: z.number().int().nonnegative(),
      naval: z.number().int().nonnegative(),
    })
    .strict();
  return z
    .object({
      version: z.number().int().positive(),
      source: z.string(),
      ships: z.record(z.string(), shipSchema).superRefine((map, ctx) => {
        for (const id of Object.keys(map)) {
          if (!goods.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `ship id "${id}" is not a vendor good` });
        }
      }),
    })
    .strict();
}

// `knownGoods`: the resource ids gear and upkeep may name (the buildings.json
// vendor keys). JSON object keys are unique by construction, so id uniqueness is
// guaranteed by the record shape; kebab-case is checked explicitly.
export function parseUnitsContent(data: unknown, knownGoods: Iterable<string>): UnitsContent {
  const parsed = unitsContentSchema(new Set(knownGoods)).parse(data) as UnitsContent;
  if (Object.keys(parsed.units).length === 0) throw new Error("units.json must define at least one unit");
  return parsed;
}

export function parseBandsContent(data: unknown, knownGoods: Iterable<string>): BandsContent {
  const parsed = bandsContentSchema(new Set(knownGoods)).parse(data) as BandsContent;
  const ids = Object.keys(parsed.bands);
  if (ids.length < parsed.market.offersPerSeason) {
    throw new Error(`bands.json must define at least market.offersPerSeason (${parsed.market.offersPerSeason}) bands, got ${ids.length}`);
  }
  return parsed;
}

// Ship ids must be vendor goods (the player's stock is the fleet).
export function parseShipsContent(data: unknown, knownGoods: Iterable<string>): ShipsContent {
  const parsed = shipsContentSchema(new Set(knownGoods)).parse(data) as ShipsContent;
  if (Object.keys(parsed.ships).length === 0) throw new Error("ships.json must define at least one ship");
  return parsed;
}

export function unitDef(content: UnitsContent, unitId: string): UnitDef | null {
  return content.units[unitId] ?? null;
}

export function bandDef(content: BandsContent, bandId: string): BandDef | null {
  return content.bands[bandId] ?? null;
}

// --- Deterministic rolls ----------------------------------------------------
// sha256 in plain TypeScript (FIPS 180-4), so this module stays free of node
// builtins — @massalia/shared is also bundled into the browser client.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

// Returns the 8 state words of sha256(message).
export function sha256Words(message: string): Uint32Array {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 2 ** 32));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15]!;
      const w2 = w[i - 2]!;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return h;
}

// Deterministic roll in [0, 1): sha256 of the "|"-joined parts, first 4 bytes as
// a uint32 / 2^32. Every roll in the barracks system (market offers, renewals)
// goes through this so the same inputs always give the same outcome — a
// re-login never rerolls. Math.random is not used anywhere in the system.
export function seededRoll(seedParts: string[]): number {
  return sha256Words(seedParts.join("|"))[0]! / 2 ** 32;
}
