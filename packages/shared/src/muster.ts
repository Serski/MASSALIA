import { campaignSeason, seasonIndexAt } from "./buildings.js";
import { renderForce, renderPlunder, type CampaignForcePart, type PlunderPayload } from "./chronicle.js";
import type { KoinonContent } from "./koinon.js";

// ---------------------------------------------------------------------------
// The koinon's Raid muster (koinon prompt 3): the pure rules. Members pledge men
// and hulls to one raid; at the launch instant they fight as one army and the
// plunder is split by shares, one per man sent and one per seat of hull space
// that carried a man. Nothing here touches a database or the clock: the server
// passes instants in, and both the locked resolve and the read-only outlook on
// the koinon page call the same functions.
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;

// The launch instant for a lead chosen by the opener (P1): a whole number of
// minutes from `minLeadMinutes` to `maxLeadHours`, counted from the server's
// clock, never landing in Winter. Opening in Winter for a Spring instant is fine.
export type MusterLaunch = { ok: true; launchAtMs: number } | { ok: false; reason: "lead" | "winter" };
export function musterLaunch(nowMs: number, leadMinutes: unknown, worldStartedMs: number, content: KoinonContent): MusterLaunch {
  const { minLeadMinutes, maxLeadHours } = content.muster;
  if (typeof leadMinutes !== "number" || !Number.isInteger(leadMinutes) || leadMinutes < minLeadMinutes || leadMinutes > maxLeadHours * 60) {
    return { ok: false, reason: "lead" };
  }
  const launchAtMs = nowMs + leadMinutes * MINUTE_MS;
  if (!campaignSeason(launchAtMs, worldStartedMs).open) return { ok: false, reason: "winter" };
  return { ok: true, launchAtMs };
}

// The Winter a launch chosen now could land in: the first Winter season that
// begins before the longest lead runs out, or null. The launch picker greys
// out the leads that fall inside it; musterLaunch is still the judge.
const SEASON_MS = 86_400_000;
export function musterWinter(nowMs: number, worldStartedMs: number, content: KoinonContent): { fromMs: number; untilMs: number } | null {
  const horizonMs = nowMs + content.muster.maxLeadHours * 60 * MINUTE_MS;
  for (let i = seasonIndexAt(nowMs, worldStartedMs); worldStartedMs + i * SEASON_MS <= horizonMs; i++) {
    const fromMs = worldStartedMs + i * SEASON_MS;
    if (!campaignSeason(fromMs, worldStartedMs).open) return { fromMs, untilMs: fromMs + SEASON_MS };
  }
  return null;
}

// One owner's pledge of one hull type, as it counts at launch.
export type MusterHull = { ownerId: string; shipId: string; count: number; range: number; troopSpace: number; naval: number; pledgedAtMs: number };
// The fleet for a crossing of `seaSteps` seas: the hulls that sail, their naval
// power and troop space, how much of the force's space found a seat, how much
// did not (`short`), and the seats filled per owner.
export type MusterLoad = { sailing: MusterHull[]; naval: number; space: number; filled: number; short: number; seats: Record<string, number> };

// P6 and P7. Every pledged hull whose range covers the crossing sails; one that
// falls short neither sails nor counts. The men's space is loaded onto the
// sailing hulls in order of pledge time, then owner id, then the roomier hull
// first (a transport before a warship), and each owner is credited the seats of
// his hulls that are filled.
export function loadMusterHulls(forceSpace: number, seaSteps: number, hulls: MusterHull[]): MusterLoad {
  const sailing = hulls
    .filter((h) => h.count > 0 && h.range >= seaSteps)
    .sort((a, b) => a.pledgedAtMs - b.pledgedAtMs || (a.ownerId < b.ownerId ? -1 : a.ownerId > b.ownerId ? 1 : 0) || b.troopSpace - a.troopSpace || (a.shipId < b.shipId ? -1 : a.shipId > b.shipId ? 1 : 0));
  const seats: Record<string, number> = {};
  let remaining = Math.max(0, forceSpace);
  for (const h of sailing) {
    const take = Math.min(remaining, h.count * h.troopSpace);
    if (take <= 0) continue;
    seats[h.ownerId] = (seats[h.ownerId] ?? 0) + take;
    remaining -= take;
  }
  return {
    sailing,
    naval: sailing.reduce((n, h) => n + h.count * h.naval, 0),
    space: sailing.reduce((n, h) => n + h.count * h.troopSpace, 0),
    filled: Math.max(0, forceSpace) - remaining,
    short: remaining,
    seats,
  };
}

// Ruling 5: one share per man sent and one per seat of hull space carried.
export function musterShares(men: Record<string, number>, seats: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of new Set([...Object.keys(men), ...Object.keys(seats)])) {
    const shares = (men[id] ?? 0) + (seats[id] ?? 0);
    if (shares > 0) out[id] = shares;
  }
  return out;
}

// P8. Whole parts of `total` by largest remainder over the shares, ties to the
// lower id, so the parts add up to the whole. Integer arithmetic throughout.
export function splitByShares(total: number, shares: Record<string, number>): Record<string, number> {
  const ids = Object.keys(shares).filter((id) => shares[id]! > 0).sort();
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  const sum = ids.reduce((n, id) => n + shares[id]!, 0);
  if (total <= 0 || sum <= 0) return out;
  let given = 0;
  for (const id of ids) {
    out[id] = Math.floor((total * shares[id]!) / sum);
    given += out[id]!;
  }
  // The leftover units go one each to the largest remainders ((total × share) mod sum).
  const byRemainder = [...ids].sort((a, b) => ((total * shares[b]!) % sum) - ((total * shares[a]!) % sum) || (a < b ? -1 : a > b ? 1 : 0));
  for (let i = 0; i < total - given; i++) out[byRemainder[i]!]! += 1;
  return out;
}

// The Chronicle payload of one participant: the army's outcome and his own part
// in it. `force` is his own rows, `hulls` the hulls of his that sailed, `killed`
// the army's kills, `lost` his own losses, `share` his part of the plunder.
export type MusterChronicle = {
  koinonName: string;
  regionId: string;
  regionName?: string;
  townId?: string;
  townName?: string;
  force: CampaignForcePart[];
  hulls: number;
  winner: "attacker" | "defender" | "repulsed";
  killed: number;
  lost: number;
  share: PlunderPayload | null;
};

// The one sentence for a muster entry, shared by the server's report and the
// web register so the wording never drifts.
export function renderMusterLine(p: MusterChronicle): string {
  const place = p.townName ?? p.regionName ?? p.regionId;
  const koinon = `with the koinon ${p.koinonName}`;
  if (p.winner === "repulsed") return `Sailed against ${place} ${koinon} and were driven off by its fleet before landing.`;
  const men = renderForce(p.force);
  const hulls = p.hulls > 0 ? `${p.hulls} ${p.hulls === 1 ? "hull" : "hulls"}` : "";
  const sent = men && hulls ? `${men} and ${hulls}` : men || hulls || "no one";
  const isTown = p.townId !== undefined;
  const defenders = isTown ? (p.killed === 1 ? "soldier" : "soldiers") : p.killed === 1 ? "tribesman" : "tribesmen";
  const killed = `${p.killed} ${defenders} slain`;
  const lost = p.lost === 0 ? "none of ours lost" : `${p.lost} of ours lost`;
  if (p.winner === "attacker") {
    return `Raided ${place} ${koinon}: sent ${sent}, ${killed}, ${lost}, ${renderPlunder(p.share)} for our share.`;
  }
  return `Raided ${place} ${koinon} and were driven off: sent ${sent}, ${killed}, ${lost}.`;
}

// The koinon's own line for a marched muster, on the Koinon tab's last-muster
// report: the whole army's outcome, where renderMusterLine tells one member's.
export type MusterReportLine = { regionId: string; regionName?: string; townId?: string | null; townName?: string | null; outcome: "won" | "driven_off" | "repulsed"; men: number; killed: number; lost: number; plunder: PlunderPayload | null };
export function renderMusterReportLine(p: MusterReportLine): string {
  const place = p.townName ?? p.regionName ?? p.regionId;
  if (p.outcome === "repulsed") return `Sailed against ${place} and were driven off by its fleet before landing.`;
  const isTown = p.townId !== undefined && p.townId !== null;
  const defenders = isTown ? (p.killed === 1 ? "soldier" : "soldiers") : p.killed === 1 ? "tribesman" : "tribesmen";
  const sent = `${p.men} ${p.men === 1 ? "man" : "men"} sent, ${p.killed} ${defenders} slain, ${p.lost === 0 ? "none lost" : `${p.lost} lost`}`;
  if (p.outcome === "won") return `Raided ${place}: ${sent}, ${renderPlunder(p.plunder)} taken.`;
  return `Raided ${place} and were driven off: ${sent}.`;
}
