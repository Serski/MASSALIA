import { useState } from "react";
import { forceStats, HOME_POLITY_ID, LEAGUE_MOVE_REFUSAL, leagueSuppliesRefusal, marchMinutes, moveVerdict, routeFor, verdictsFor } from "@massalia/shared";
import { api, ApiError, type BarracksRosterRow, type BaseView, type LeagueMapView, type MapActType, type MapReachView, type MoveTargetView, type ReachEntry } from "../api.js";
import { AssetIcon, POLITY_CREST } from "../dashboard/shared.js";
import { FAST_SPD, MARCH_CLOCK, moveTravel, travelClock } from "./marchClock.js";
import type { PickerResult, PickTarget } from "./World2Map.js";

// ---------------------------------------------------------------------------
// The League's order sheet (government prompt 5b, ruling 4 at STOP 1). A
// sitting Archon or Strategos commands the League's army here, and nowhere in
// the house's force picker: commanding the army is not choosing one's own
// troops. The sheet carries the League's colour and crest, says who gives the
// order and from which seat, lists the League's men standing in each of its
// places by type (he chooses a number of each, from one place), the hulls for
// a crossing, what the voyage costs the treasury and what the treasury holds,
// and one button that gives the order. The server stays authoritative: it
// reads the seat again and its refusal lands in the sheet as it is.
// ---------------------------------------------------------------------------

const ORDER_TITLE: Record<MapActType | "move", string> = { attack: "Attack on", raid: "Raid on", scout: "Scout of", move: "Move to" };
const OFFICE_LABEL = { archon: "Archon", strategos: "Strategos" } as const;
const SIDE_LABEL: Record<string, string> = { palaioi: "Palaioi", dynatoi: "Dynatoi" };

// "Ordered by Seskios, Archon (Dynatoi)"; a Strategos has no side.
export function orderedByLine(by: NonNullable<LeagueMapView["orderedBy"]>): string {
  const side = by.side ? SIDE_LABEL[by.side] : undefined;
  return `Ordered by ${by.name}, ${OFFICE_LABEL[by.office]}${side ? ` (${side})` : ""}`;
}

// The League's men of one type standing at one place: one or more roster rows.
type TypeGroup = { key: string; label: string; plural: string; icon: string; source: BarracksRosterRow["source"]; stats: BarracksRosterRow["stats"]; rows: BarracksRosterRow[]; count: number };
const SEP = "\u0000";

export function LeagueOrderSheet({
  type,
  target,
  entry,
  moveTargets = [],
  places,
  fleet,
  roster,
  orderedBy,
  treasury,
  color,
  onClose,
  onOrdered,
}: {
  type: MapActType | "move";
  /** the region or town the order is for; for a move, the League's place the men go to */
  target: PickTarget;
  /** the reach entry for the target's region (a scout, a raid or an attack) */
  entry?: ReachEntry | undefined;
  /** the League's places men may be moved to (a move) */
  moveTargets?: MoveTargetView[];
  /** the League's places, in the order the server lists them */
  places: BaseView[];
  fleet: MapReachView["fleet"];
  /** the League's rows; null while they load */
  roster: BarracksRosterRow[] | null;
  /** the official giving the order, as the server names him */
  orderedBy: LeagueMapView["orderedBy"];
  /** the League treasury, and what a unit of naval supplies costs it now */
  treasury: { balance: number; supplyPrice: number };
  /** the League's colour */
  color: string;
  onClose: () => void;
  onOrdered: (res: PickerResult) => void;
}) {
  // How many men of each type go, keyed by place and type. An order marches
  // from one place: a number entered at a second place clears the first.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [switched, setSwitched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The hulls chosen for a crossing; null until he edits the automatic assembly.
  const [shipPick, setShipPick] = useState<Record<string, number> | null>(null);
  const isMove = type === "move";
  const dest = isMove ? (moveTargets.find((t) => t.id === target.id) ?? null) : null;

  // The men standing in each place, by type. Men on the road are no one's to order.
  const standing = (roster ?? []).filter((r) => r.active && r.movingTo === null && r.mission?.kind !== "muster");
  const byPlace = new Map<string, Map<string, TypeGroup>>();
  for (const r of standing) {
    const types = byPlace.get(r.basedAt) ?? new Map<string, TypeGroup>();
    const key = `${r.source}:${r.unitId}`;
    const g = types.get(key) ?? { key, label: r.label, plural: r.plural, icon: r.icon, source: r.source, stats: r.stats, rows: [], count: 0 };
    g.rows.push(r);
    g.count += r.count;
    types.set(key, g);
    byPlace.set(r.basedAt, types);
  }
  // The League's places in the server's order, then any other place its men stand.
  const placeIds = [...places.map((p) => p.id).filter((id) => byPlace.has(id)), ...[...byPlace.keys()].filter((id) => !places.some((p) => p.id === id))];
  const placeName = (id: string) => places.find((p) => p.id === id)?.name ?? id;

  const chosenOf = (placeId: string) => [...(byPlace.get(placeId)?.values() ?? [])].map((g) => ({ g, n: Math.min(g.count, Math.max(0, counts[`${placeId}${SEP}${g.key}`] ?? 0)) })).filter((c) => c.n > 0);
  const from = placeIds.find((id) => chosenOf(id).length > 0) ?? null;
  const chosen = from ? chosenOf(from) : [];
  const setCount = (placeId: string, g: TypeGroup, value: number) => {
    // A band marches as one: all of it or none.
    const n = g.source === "band" ? (value > 0 ? g.count : 0) : Math.min(g.count, Math.max(0, Math.floor(value) || 0));
    setCounts((prev) => {
      const others = Object.entries(prev).some(([k, v]) => v > 0 && !k.startsWith(`${placeId}${SEP}`));
      if (others && n > 0) setSwitched(true);
      const kept = Object.fromEntries(Object.entries(prev).filter(([k]) => k.startsWith(`${placeId}${SEP}`)));
      return { ...(n > 0 ? kept : prev), [`${placeId}${SEP}${g.key}`]: n };
    });
  };
  // The rows the order names: each type's number spread over its rows in turn.
  const sent = chosen.flatMap(({ g, n }) => {
    const out: { rowId: string; count: number }[] = [];
    let left = n;
    for (const r of [...g.rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      if (left <= 0) break;
      const take = Math.min(r.count, left);
      out.push({ rowId: r.id, count: take });
      left -= take;
    }
    return out;
  });

  const fleetStats = { range: fleet.range, space: fleet.space, tiers: fleet.tiers };
  const verdictOf = (steps: { landSteps: number | null; seaSteps: number | null }, force: ReturnType<typeof forceStats>) => {
    if (isMove) return moveVerdict(steps, force, fleetStats);
    const v = verdictsFor(steps, force, fleetStats);
    return type === "attack" ? v.attack : v.raid;
  };
  const stepsFrom = (placeId: string) => (isMove ? dest?.byBase?.[placeId] : (entry?.byBase?.[placeId] ?? entry));
  // Whether any party at all could go from a place: one fast man in one hull's
  // space, so a place greys only for reasons no choice could mend.
  const placeVerdict = (placeId: string): { ok: boolean; reason?: string } => {
    if (isMove && placeId === target.id) return { ok: false, reason: "The men already stand there." };
    const steps = stepsFrom(placeId);
    if (!steps) return { ok: false, reason: isMove ? LEAGUE_MOVE_REFUSAL : "That land cannot be reached." };
    return verdictOf(steps, forceStats([{ spd: FAST_SPD, space: 1, count: 1 }]));
  };

  const force = forceStats(chosen.map(({ g, n }) => ({ spd: g.stats.spd ?? 0, space: g.stats.space ?? 1, count: n })));
  const steps = from === null ? undefined : stepsFrom(from);
  let verdict: { ok: boolean; reason?: string } = steps ? verdictOf(steps, force) : { ok: false, reason: "Choose the men by type and number." };
  if (from !== null && isMove && from === target.id) verdict = { ok: false, reason: "The men already stand there." };
  if (verdict.ok && type === "scout" && !chosen.some(({ g }) => (g.stats.spd ?? 0) >= FAST_SPD)) verdict = { ok: false, reason: `A scouting party needs a man at Spd ${FAST_SPD} or more.` };
  const route = steps && chosen.length > 0 ? (isMove ? moveTravel(steps) : routeFor(type === "attack" ? "attack" : "raid", steps)) : null;

  // A crossing: the League's hulls in port, the automatic assembly (transports
  // that can make it first, warships for what is still short, as the server
  // assembles them), and his own choice over it for a scout, a raid or an attack.
  const hulls = fleet.hulls ?? [];
  const seaSteps = route?.route === "sea" ? route.steps : null;
  const automatic = (seas: number): Record<string, number> => {
    const pick: Record<string, number> = {};
    let space = 0;
    for (const role of ["transport", "warship"] as const) {
      for (const h of hulls) {
        if (h.role !== role || h.range < seas || space >= force.space) continue;
        const n = Math.min(h.count, h.troopSpace > 0 ? Math.ceil((force.space - space) / h.troopSpace) : 0);
        if (n > 0) {
          pick[h.id] = n;
          space += n * h.troopSpace;
        }
      }
    }
    return pick;
  };
  // A move sails the server's own assembly; an action may name its hulls.
  const sailing = seaSteps !== null ? (isMove ? automatic(seaSteps) : (shipPick ?? automatic(seaSteps))) : null;
  const chosenShips = !isMove ? sailing : null;
  const sailingHulls = sailing ? hulls.filter((h) => (sailing[h.id] ?? 0) > 0).map((h) => ({ ...h, count: sailing[h.id]! })) : [];
  const carries = sailingHulls.filter((h) => h.role === "transport").reduce((n, h) => n + h.count * h.troopSpace, 0);
  const escort = sailingHulls.filter((h) => h.role === "warship");
  const slowest = sailingHulls.length ? Math.min(...sailingHulls.map((h) => h.range)) : 0;
  if (chosenShips && seaSteps !== null && verdict.ok) {
    if (slowest < seaSteps) verdict = { ok: false, reason: `Beyond the fleet's range (${seaSteps} seas, fleet reaches ${slowest}).` };
    else if (carries < force.space) verdict = { ok: false, reason: `Not enough hulls: ${force.space} space needed, ${carries} aboard.` };
  }
  // The treasury buys the naval supplies every hull that sails uses.
  const suppliesNeed = sailingHulls.reduce((n, h) => n + h.count * (h.suppliesPerTrip ?? 0), 0);
  const cost = suppliesNeed * treasury.supplyPrice;
  if (verdict.ok && cost > treasury.balance) verdict = { ok: false, reason: leagueSuppliesRefusal(cost, treasury.balance) };
  const setShip = (id: string, value: number) => {
    const h = hulls.find((x) => x.id === id);
    if (!h) return;
    setShipPick({ ...(sailing ?? {}), [id]: Math.min(h.count, Math.max(0, Math.floor(value) || 0)) });
  };

  const give = async () => {
    setBusy(true);
    setError("");
    try {
      const res = isMove ? await api.leagueMove(target.id, sent) : await api.leagueAct(type, target.kind === "town" ? { townId: target.id } : { regionId: target.id }, sent, chosenShips ?? undefined);
      onOrdered(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };

  const crest = POLITY_CREST[HOME_POLITY_ID];
  const title = `${ORDER_TITLE[type]} ${target.name}`;
  const hullWords = (h: { count: number; label: string }) => `${h.count} ${h.label.toLowerCase()}${h.count === 1 ? "" : "s"}`;
  return (
    <div className="w2map-modal w2map-order" role="dialog" aria-label={`The League's order: ${title}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div className="w2map-modal-card w2map-order-card" style={{ borderTopColor: color }}>
        <button type="button" className="w2map-info-close" onClick={onClose} aria-label="Close">Close</button>
        <div className="w2map-modal-head w2map-order-head">
          <div className="w2map-order-banner" style={{ background: color }}>
            {crest ? <img className="w2map-order-crest" src={crest} alt="" width={36} height={36} /> : null}
            <span className="w2map-order-whose">The League's army</span>
          </div>
          <div className="w2map-info-label w2map-order-title">{title}</div>
          {orderedBy ? <p className="w2map-order-by">{orderedByLine(orderedBy)}</p> : null}
        </div>
        <div className="w2map-pick-scroll">
          {roster === null ? (
            <p className="w2map-info-empty">Mustering…</p>
          ) : placeIds.length === 0 ? (
            <p className="w2map-info-empty">The League has no men standing.</p>
          ) : (
            placeIds.map((placeId) => {
              const cannot = placeVerdict(placeId);
              const unreachable = !cannot.ok;
              const other = from !== null && from !== placeId;
              return (
                <div key={placeId} className={`w2map-pick-group w2map-order-place${unreachable ? " unreachable" : ""}`} data-place={placeId}>
                  <p className="w2map-pick-base">{placeName(placeId)}</p>
                  {unreachable ? <p className="w2map-pick-why">{cannot.reason}</p> : null}
                  <ul className="w2map-pick-list">
                    {[...byPlace.get(placeId)!.values()].map((g) => {
                      const n = Math.min(g.count, Math.max(0, counts[`${placeId}${SEP}${g.key}`] ?? 0));
                      return (
                        <li key={g.key} className={`w2map-pick-row${unreachable || other ? " dim" : ""}`}>
                          <span className="w2map-pick-check">
                            <AssetIcon file={g.icon} alt="" className="asset-icon w2map-pick-icon" fallback={<span aria-hidden="true">🛡️</span>} />
                            <span className="w2map-pick-label">{g.plural} · {g.count.toLocaleString()} standing</span>
                            <input
                              type="number"
                              className="w2map-pick-count"
                              min={0}
                              max={g.count}
                              value={n}
                              disabled={unreachable || busy}
                              onChange={(e) => setCount(placeId, g, parseInt(e.target.value, 10))}
                              aria-label={`${g.plural} from ${placeName(placeId)}`}
                            />
                          </span>
                          <span className="w2map-pick-note">
                            Atk {g.stats.atk ?? 0} · Def {g.stats.def ?? 0} · Msl {g.stats.msl ?? 0} · Mor {g.stats.mor ?? 0} · Spd {g.stats.spd ?? 0} · Space {g.stats.space ?? 1}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
          {switched ? <p className="w2map-pick-why">An order marches from one place.</p> : null}
          {sailing && seaSteps !== null ? (
            <div className="w2map-pick-ships" data-testid="order-hulls">
              <p className="w2map-pick-base">The League's hulls</p>
              <ul className="w2map-pick-list">
                {hulls.map((h) => (
                  <li key={h.id} className="w2map-pick-row">
                    <span className="w2map-pick-check">
                      <span className="w2map-pick-label">{h.label} · {h.count} in port</span>
                      <input
                        type="number"
                        className="w2map-pick-count"
                        min={0}
                        max={h.count}
                        value={sailing[h.id] ?? 0}
                        disabled={busy || isMove}
                        onChange={(e) => setShip(h.id, parseInt(e.target.value, 10))}
                        aria-label={`${h.label}s to sail`}
                      />
                    </span>
                    <span className="w2map-pick-note">{h.role === "warship" ? "escort" : `carries ${h.troopSpace}`} · range {h.range}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="w2map-modal-footer">
          <div className={`w2map-verdict${verdict.ok ? " ok" : ""}`}>
            {chosen.length === 0 ? (
              <span>Choose the men by type and number.</span>
            ) : (
              <>
                <span>{force.men.toLocaleString()} men from {placeName(from!)}</span>
                {route ? (
                  <span>
                    {route.route === "within"
                      ? "within the region"
                      : route.route === "land"
                        ? `by land · ${route.steps} step${route.steps === 1 ? "" : "s"}`
                        : `by sea · ${route.steps} sea${route.steps === 1 ? "" : "s"} · ${sailingHulls.filter((h) => h.role === "transport").map(hullWords).join(", ") || "no transport"} carry ${carries} of ${force.space}${escort.length ? ` · ${escort.map(hullWords).join(", ")} escort` : ""}`}
                    {` · arrives in ${travelClock("minutes" in route ? route.minutes : marchMinutes(MARCH_CLOCK, route))}`}
                  </span>
                ) : null}
                {!verdict.ok ? <span>{verdict.reason}</span> : null}
              </>
            )}
            {/* What the order costs the treasury, and what the treasury holds, before he gives it. */}
            <span className="w2map-order-cost" data-testid="order-cost">
              {suppliesNeed > 0
                ? `Cost to the treasury: ${cost.toLocaleString()} drachmae for ${suppliesNeed} naval ${suppliesNeed === 1 ? "supply" : "supplies"}`
                : "No cost to the treasury"}
              {` · ${treasury.balance.toLocaleString()} drachmae in the treasury`}
            </span>
          </div>
          {error ? <p className="w2map-action-why" role="alert">{error}</p> : null}
          <div className="w2map-actions">
            <button type="button" className="w2map-action w2map-order-give" disabled={busy || chosen.length === 0 || !verdict.ok} onClick={give}>
              {busy ? "…" : "Give the order"}
            </button>
            <button type="button" className="w2map-action ghost" disabled={busy} onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
