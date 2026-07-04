import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type BuildingsCatalog, type BuildingsMine, type CatalogEntry, type OwnedBuilding, type ClassSection, type VendorPrice, type ServiceView, type MercBoard, type RiskOutcome } from "../../api.js";
import { assetPath } from "../../data/league.js";
import { GOOD_ICON, PanelBanner, type PanelProps, PanelRow, buildCountdown, formatPerDay, idleReason, popName } from "../shared.js";

// What a building provides per day: drachmae income first (income-only lines like
// trader/philosopher/hetaira would otherwise read blank), then each good. Income
// rides the same rounding as goods and is omitted when there is none (< 1/day).
// Good names go through content goodLabels (grain → "Wheat"); never the raw id.
function yieldSummary(yields: { good: string; perDay: number }[], income = 0, goodLabels: Record<string, string> = {}): string {
  const name = (good: string) => goodLabels[good] ?? good.charAt(0).toUpperCase() + good.slice(1);
  const parts: string[] = [];
  if (income >= 1) parts.push(`${formatPerDay(income)} dr/day`);
  for (const y of yields) parts.push(`${formatPerDay(y.perDay)} ${name(y.good)}/day`);
  return parts.join(" · ");
}

// A building's full staffing requirement as a readable line ("1 Slave"), or "".
function staffReqLine(staffing: Record<string, number>): string {
  return Object.entries(staffing)
    .filter(([, q]) => (q ?? 0) > 0)
    .map(([ty, q]) => `${q} ${popName(ty)}`)
    .join(" · ");
}

function ClassBuildingLadder({
  entry,
  owned,
  busy,
  onBuild,
  onUpgrade,
  goodLabels,
  pops,
  balances,
}: {
  entry: CatalogEntry;
  owned?: OwnedBuilding;
  busy: boolean;
  onBuild: () => void;
  onUpgrade: () => void;
  goodLabels: Record<string, string>;
  pops: Record<string, number>; // owned (the shared staffing pool)
  balances: Record<string, number>; // material holdings
}) {
  const currentTier = owned ? owned.tier : 0; // 0 = not yet built
  const active = owned?.status === "active";
  const constructing = owned?.status === "constructing";
  const maxTier = entry.tiers.length;
  // The single buildable tier right now: tier 1 if unbuilt; the next tier up if we
  // own an active building below max; none while constructing or at max tier.
  const nextTier = !owned ? 1 : active && currentTier < maxTier ? currentTier + 1 : null;
  const label = (good: string) => goodLabels[good] ?? good[0]!.toUpperCase() + good.slice(1);

  return (
    <ol className="tier-ladder">
      {entry.tiers.map((t) => {
        const state =
          t.tier < currentTier
            ? "built"
            : t.tier === currentTier
              ? constructing
                ? "constructing"
                : "current"
              : t.tier === nextTier
                ? "next"
                : "future";
        const isBuilt = t.tier < currentTier || (t.tier === currentTier && active);
        const idle = state === "current" && Boolean(owned?.idle);
        const provides = yieldSummary(t.yields, t.income, goodLabels) || "—";
        const tag = idle
          ? "Idle"
          : state === "built"
            ? "Built"
            : state === "current"
              ? "Current"
              : state === "constructing"
                ? "Building"
                : state === "future"
                  ? "Locked"
                  : null;

        // The build/upgrade gate for the buildable tier: materials + owned staff.
        const bill = state === "next";
        const matBill = Object.entries(t.materials).map(([g, q]) => `${q} ${label(g)}`).join(" · ");
        const staffBill = Object.entries(t.staffing).map(([ty, q]) => `${q} ${popName(ty)}`).join(" · ");
        const shortfalls = bill
          ? [
              ...Object.entries(t.materials)
                .filter(([g, q]) => (balances[g] ?? 0) < q)
                .map(([g, q]) => `${Math.ceil(q - (balances[g] ?? 0))} ${label(g)}`),
              ...Object.entries(t.staffing)
                .filter(([ty, q]) => (pops[ty] ?? 0) < (q ?? 0))
                .map(([ty, q]) => `${(q ?? 0) - (pops[ty] ?? 0)} more ${popName(ty)}`),
            ]
          : [];
        const blocked = shortfalls.length > 0;

        return (
          <li key={t.tier} className={`tier-step tier-${state}${idle ? " tier-idle" : ""}`}>
            <span className="tier-marker" aria-hidden="true">{isBuilt ? "✓" : t.tier}</span>
            <div className="tier-body">
              <div className="tier-head">
                <span className="tier-name">
                  Tier {t.tier} · {t.name ?? entry.name}{t.rank ? ` · ${t.rank}` : ""}
                </span>
                {tag ? <span className="tier-tag">{tag}</span> : null}
              </div>
              <div className="tier-provides">{provides}</div>
              <div className="tier-meta">
                {state === "constructing"
                  ? `under construction · ${buildCountdown(owned?.completesAt ?? null)}`
                  : `${t.cost}dr · ${t.buildDays}d${t.upkeep > 0 ? ` · upkeep ${t.upkeep}dr/day` : ""}`}
              </div>
              {(state === "current" || state === "built") && staffReqLine(t.staffing) ? (
                <div className="tier-meta">Staff: {staffReqLine(t.staffing)}</div>
              ) : null}
              {idle ? (
                <div className="tier-gate">Idle — {idleReason(t.staffing, pops)}.</div>
              ) : null}
              {bill ? (
                <>
                  <div className="tier-meta">Needs: {matBill || "—"}{staffBill ? ` · staff ${staffBill}` : ""}</div>
                  {blocked ? <div className="tier-gate">Short: {shortfalls.join(", ")}</div> : null}
                </>
              ) : null}
            </div>
            {state === "next" ? (
              <button type="button" className="panel-btn" disabled={busy || blocked} onClick={owned ? onUpgrade : onBuild}>
                {owned ? "Upgrade" : "Build"} · {t.cost}dr
              </button>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// The class-section slot. Built to render a list of stateful, time-bound, stat-
// gated entries (the hoplite's future contracts); for now every class's list is
// empty, so it shows a labelled "coming soon" placeholder.
function ClassActionsList({ section }: { section: ClassSection }) {
  if (!section.label) {
    // Landowner / slave: no class section — a flavor line, not a slot.
    return section.flavor ? <p className="dashboard-todo">{section.flavor}</p> : null;
  }
  // The priest's signature verb is the pilgrimage (PRIEST STEP 2): sacred travel
  // to Delphi, Gaul, and Syracuse. The Sanctuary building ships now; the travel
  // system is a clean labelled stub here until that build lands.
  const comingSoon =
    section.label === "Rites"
      ? { title: "Pilgrimage — coming soon", sub: "Sacred travel to Delphi, Gaul, and Syracuse arrives in a later build." }
      : { title: `${section.label} — coming soon`, sub: "This path's stateful undertakings arrive in a later build." };
  return (
    <>
      <div className="panel-label">{section.label}</div>
      <div className="panel-grid2">
        {section.entries.length === 0 ? (
          <PanelRow icon="📜" title={comingSoon.title} sub={comingSoon.sub} dim />
        ) : (
          section.entries.map((entry) => (
            <PanelRow
              key={entry.id}
              icon="📜"
              title={entry.title}
              sub={entry.detail}
              tag={entry.status}
            />
          ))
        )}
      </div>
    </>
  );
}

// The hoplite's "Service" section: the home army rank ladder + daily salary
// (Step 1) AND the mercenary hiring board + go/return lifecycle (Step 2). Rendered
// in the class-section slot for hoplites only; other classes keep the generic
// ClassActionsList placeholder.
function ServiceSection({ label, onRefresh }: { label: string; onRefresh: () => void }) {
  const [data, setData] = useState<ServiceView | null>(null);
  const [merc, setMerc] = useState<MercBoard | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The contract-return outcome (Step 4). STICKY: set only when an outcome arrives
  // (a board read that completes a contract, or a collect/cancel action), never
  // cleared by a subsequent empty read — so it survives the StrictMode re-fetch and
  // stays visible until the player leaves the panel.
  const [outcome, setOutcome] = useState<MercBoard["justReturned"]>(null);

  const load = useCallback(async () => {
    const [s, b] = await Promise.all([api.service(), api.mercBoard()]);
    setData(s);
    setMerc(b);
    if (b.justReturned) setOutcome(b.justReturned);
  }, []);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to load your service record."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setNote("");
    try {
      const res = (await fn()) as { outcome?: RiskOutcome | null; awardedTraits?: string[]; died?: boolean } | undefined;
      // Capture an outcome surfaced by the action itself (e.g. collecting the final
      // foreign pay that completes the term) — robust against the lazy-read path.
      if (res?.outcome) setOutcome({ outcome: res.outcome, awardedTraits: res.awardedTraits ?? [], died: res.died ?? false, composureHit: 0 });
      await load();
      onRefresh();
      if (ok) setNote(ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };

  if (!data || !merc) {
    return (
      <>
        <div className="panel-label">{label}</div>
        <p className="dashboard-todo">{note || "Reading the muster roll…"}</p>
      </>
    );
  }

  const accrued = data.accrued;
  const hasAccrued = accrued.drachmae > 0 || accrued.militia > 0;
  const next = data.next;
  const enlisted = data.rankId !== "none";
  const abroad = data.abroad;
  const current = merc.current;
  // The outcome of a contract that just resolved (Step 4), from sticky state. Death
  // is also handled by the succession screen taking over after onRefresh.
  const jr = outcome;
  const returnMessage = jr
    ? jr.outcome === "death"
      ? "You fell abroad — your heir takes up the name."
      : jr.outcome === "injury"
        ? `A wound will trouble you for life — you come home ${jr.awardedTraits.includes("lamed") ? "lamed" : "one-eyed"}.`
        : jr.outcome === "scare"
          ? "You come home war-scarred, but whole."
          : "You return whole and richer."
    : null;

  return (
    <>
      <div className="panel-label">{label}</div>
      <div className="panel-grid2">
        {enlisted && data.rank ? (
          <PanelRow
            icon="🛡️"
            title={`${data.rank.name} · ${data.rank.salaryPerDay}dr/day`}
            sub={abroad ? "Home rank salary paused — you are serving abroad" : `Home garrison${data.rank.militiaPerDay > 0 ? ` · +${data.rank.militiaPerDay} militia/day` : ""}`}
            dim={abroad}
            tag={abroad ? "paused" : "serving"}
          />
        ) : (
          <PanelRow icon="🛡️" title="Not enlisted" sub="Apply to the home garrison to draw a soldier's salary." />
        )}
      </div>

      {/* Home salary collect bar (paused while abroad → never shows then). */}
      {hasAccrued ? (
        <div className="ledger-collect">
          <div>
            <strong>Pay owed</strong>
            <div className="pr-s">
              {accrued.drachmae > 0 ? `${accrued.drachmae}dr` : ""}
              {accrued.drachmae > 0 && accrued.militia > 0 ? " · " : ""}
              {accrued.militia > 0 ? `+${accrued.militia} militia` : ""}
            </div>
          </div>
          <button type="button" className="primary-cta" disabled={busy} onClick={() => act(() => api.collectService(), "Pay collected.")}>
            Collect pay
          </button>
        </div>
      ) : null}

      {/* Rank actions — hidden while abroad (you act on the contract instead). */}
      {!abroad ? (
        <div className="panel-grid2">
          {!enlisted ? (
            <PanelRow
              icon="📜"
              title="Enlist — Recruit"
              sub={next ? `${next.salaryPerDay}dr/day · no requirement` : ""}
              action={
                <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.enlistService(), "Enlisted as Recruit.")}>
                  Enlist
                </button>
              }
            />
          ) : next ? (
            <PanelRow
              icon="📜"
              title={`Promote → ${next.name}`}
              sub={
                data.qualifies
                  ? `${next.salaryPerDay}dr/day · gate met (${next.gate.militia} militia / ${next.gate.prestige} prestige)`
                  : `need ${next.gate.militia} militia (you have ${data.stats.militia}) · ${next.gate.prestige} prestige (you have ${data.stats.prestige})`
              }
              dim={!data.qualifies}
              tag={data.qualifies ? undefined : "locked"}
              action={
                data.qualifies ? (
                  <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.promoteService(), `Promoted to ${next.name}.`)}>
                    Promote
                  </button>
                ) : undefined
              }
            />
          ) : (
            <PanelRow icon="🏅" title="Archilochagos" sub="The highest home rank — you command the garrison." dim />
          )}
        </div>
      ) : null}

      {/* Leave soldiering (Step 5): available — never prompted — to a wounded or
          aged-out hoplite. A single irreversible confirm; no cost, only permanence. */}
      {!abroad && data.reclass.eligible ? (
        <>
          <div className="panel-label">Leave Soldiering</div>
          <p className="pr-s" style={{ marginBottom: 6 }}>
            {data.reclass.reason === "wound"
              ? "Your wounds make the phalanx no place for you. You may hang up the spear and take up a new trade — for good."
              : "The years weigh on you. You may retire from the phalanx and take up a new trade — for good."}
          </p>
          <div className="panel-grid2">
            {data.reclass.targets.map((t) => (
              <PanelRow
                key={t.classId}
                icon="🕊️"
                title={`Become a ${t.name}`}
                sub={t.flavor}
                action={
                  <button
                    type="button"
                    className="panel-btn"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Hang up the spear and take up the life of a ${t.name}? You keep your wealth and your name, but you can never be a hoplite again. This cannot be undone.`)) {
                        act(() => api.reclassService(t.classId), `You hang up the spear — now a ${t.name}.`);
                      }
                    }}
                  >
                    Take up
                  </button>
                }
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Return outcome (Step 4): the result of a contract that just resolved. */}
      {returnMessage ? (
        <div className="ledger-collect" role="status">
          <div>
            <strong>{jr?.outcome === "death" ? "Fallen abroad" : jr?.outcome === "clean" ? "Returned home" : "Home, with scars"}</strong>
            <div className="pr-s">{returnMessage}</div>
          </div>
        </div>
      ) : null}

      {/* Hiring board (Step 2): the 5 contracts at home, or the abroad card. */}
      <div className="panel-label">Hiring Board</div>
      {abroad && current ? (
        <>
          <div className="panel-grid2">
            <PanelRow
              icon="⚔️"
              title={`Serving abroad — ${current.name}`}
              sub={`Season ${Math.min(current.seasonsElapsed + 1, current.seasonsTotal)} of ${current.seasonsTotal} · ${current.dailyDrachmae}dr/season foreign income`}
              tag="abroad"
            />
          </div>
          {current.accrued > 0 ? (
            <div className="ledger-collect">
              <div>
                <strong>Foreign pay owed</strong>
                <div className="pr-s">{current.accrued}dr</div>
              </div>
              <button type="button" className="primary-cta" disabled={busy} onClick={() => act(() => api.collectForeign(), "Foreign pay collected.")}>
                Collect pay
              </button>
            </div>
          ) : null}
          <div className="panel-grid2">
            <PanelRow
              icon="🏠"
              title="Return home"
              sub={current.canCancel ? "End the contract early and sail home (you forgo the rest of the term)." : `Sworn for now — you may return after season ${current.earliestCancelSeason} (served ${current.seasonsElapsed}).`}
              dim={!current.canCancel}
              tag={current.canCancel ? undefined : "locked"}
              action={
                current.canCancel ? (
                  <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.cancelContract(), "Returned home.")}>
                    Return
                  </button>
                ) : undefined
              }
            />
          </div>
          <p className="pr-s" style={{ marginTop: 6 }}>The contract completes on its own at the end of the term — you sail home and your home rank salary resumes.</p>
        </>
      ) : (
        <>
          <div className="panel-grid2">
            {merc.contracts.map((c) => {
              const blockedByStrategos = merc.holdsStrategos;
              const canTake = c.qualifies && !blockedByStrategos && !c.woundBarred;
              return (
                <PanelRow
                  key={c.id}
                  icon="⚔️"
                  title={`${c.name} · ${c.dailyDrachmae}dr/season`}
                  sub={
                    c.woundBarred
                      ? "Your wounds bar you from the hard wars."
                      : blockedByStrategos
                        ? "A Strategos cannot be sworn abroad."
                        : c.qualifies
                          ? `${c.termSeasons} season${c.termSeasons > 1 ? "s" : ""} · gate met (${c.gate.militia} militia / ${c.gate.prestige} prestige)`
                          : `${c.termSeasons} season${c.termSeasons > 1 ? "s" : ""} · need ${c.gate.militia} militia (you have ${merc.stats.militia}) · ${c.gate.prestige} prestige (you have ${merc.stats.prestige})`
                  }
                  dim={!canTake}
                  tag={canTake ? undefined : "locked"}
                  action={
                    canTake ? (
                      <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.takeContract(c.id), `Sworn to the ${c.name}.`)}>
                        Take contract
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
          <p className="pr-s" style={{ marginTop: 6 }}>Foreign contracts pay better than home rank, but your home salary pauses while you serve abroad. You keep your vote in the city.</p>
        </>
      )}

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </>
  );
}

function VendorDrawer({ catalog, onTrade, busy }: { catalog: BuildingsCatalog; onTrade: (action: "buy" | "sell", type: string, qty: number) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ledger-vendor">
      <button type="button" className="panel-btn" onClick={() => setOpen((v) => !v)}>
        {open ? "Close the agora" : "Visit the agora vendor"}
      </button>
      {open ? (
        <div className="panel-grid2" style={{ marginTop: 10 }}>
          {catalog.vendor.map((price: VendorPrice) => (
            <div key={price.good} className="panel-row">
              <div className="pr-l">
                <span className="pr-ic" aria-hidden="true">{GOOD_ICON[price.good] ?? "📦"}</span>
                <div>
                  <div className="pr-t">{price.good[0]!.toUpperCase() + price.good.slice(1)}</div>
                  <div className="pr-s">buy {price.buy}dr · sell {price.sell}dr</div>
                </div>
              </div>
              <span style={{ display: "flex", gap: 6 }}>
                <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => onTrade("buy", price.good, 1)}>Buy 1</button>
                <button type="button" className="panel-btn" disabled={busy} onClick={() => onTrade("sell", price.good, 1)}>Sell 1</button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="pr-s" style={{ marginTop: 6 }}>The agora trades at a fixed band ({catalog.season}); the vendor sells dear and buys cheap, so the market can never deadlock.</p>
    </div>
  );
}

// The shipbuilder's craft bench (content.craft): each good shows its recipe + the
// building-tier gate, with a Craft action. Gated/blocked when under-tier or short
// on the recipe materials (the server is the source of truth — this mirrors it).
function CraftPanel({
  catalog,
  owned,
  balances,
  busy,
  onCraft,
}: {
  catalog: BuildingsCatalog;
  owned?: OwnedBuilding;
  balances: Record<string, number>;
  busy: boolean;
  onCraft: (good: string) => void;
}) {
  const recipes = Object.entries(catalog.craft);
  if (recipes.length === 0) return null;
  const label = (good: string) => catalog.goodLabels[good] ?? good[0]!.toUpperCase() + good.slice(1);
  return (
    <>
      <div className="panel-label">Shipwright's Craft</div>
      <div className="panel-grid2">
        {recipes.map(([good, recipe]) => {
          const haveTier = owned && owned.id === recipe.building ? owned.tier : 0;
          const tierOk = haveTier >= recipe.tier;
          const shortfalls = Object.entries(recipe.recipe)
            .filter(([g, q]) => (balances[g] ?? 0) < q)
            .map(([g, q]) => `${Math.ceil(q - (balances[g] ?? 0))} ${label(g)}`);
          const blocked = !tierOk || shortfalls.length > 0;
          const recipeStr = Object.entries(recipe.recipe).map(([g, q]) => `${q} ${label(g)}`).join(" · ");
          return (
            <PanelRow
              key={good}
              icon={GOOD_ICON[good] ?? "⛵"}
              title={label(good)}
              sub={
                `${recipeStr} · needs ${buildingDisplay(catalog, recipe.building)} T${recipe.tier}` +
                (!tierOk ? ` (you have T${haveTier})` : "") +
                (shortfalls.length ? ` · short ${shortfalls.join(", ")}` : "")
              }
              dim={blocked}
              action={
                <button type="button" className="panel-btn" disabled={busy || blocked} onClick={() => onCraft(good)}>
                  Craft
                </button>
              }
            />
          );
        })}
      </div>
    </>
  );
}

function buildingDisplay(catalog: BuildingsCatalog, id: string): string {
  return catalog.classBuilding?.id === id ? catalog.classBuilding.name : catalog.commons.find((b) => b.id === id)?.name ?? id;
}

export default function LedgerPanel({ player, onRefresh }: PanelProps) {
  const [catalog, setCatalog] = useState<BuildingsCatalog | null>(null);
  const [mine, setMine] = useState<BuildingsMine | null>(null);
  const [note, setNote] = useState("");
  // `pending` is the id of the ONE action in flight (a building id, or "collect" /
  // "vendor"); null when idle. Per-building buttons key their loading/disabled state
  // off this id, so clicking one Build only spins that row's button — not every row.
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null; // any action in flight (singletons: collect/vendor/craft)

  const load = useCallback(async () => {
    const [c, m] = await Promise.all([api.buildingsCatalog(), api.buildingsMine()]);
    setCatalog(c);
    setMine(m);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to load your ledger."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  // `id` scopes the loading state to the button that fired (default "action" for the
  // panel-wide singletons). On failure the REAL server message is surfaced verbatim.
  const act = async (fn: () => Promise<unknown>, ok?: string, id = "action") => {
    if (pending) return; // one action at a time — ignore stray clicks while busy
    setPending(id);
    setNote("");
    try {
      await fn();
      await load();
      onRefresh();
      if (ok) setNote(ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setPending(null);
    }
  };

  if (!catalog || !mine) {
    return (
      <section className="dashboard-panel" aria-labelledby="ledger-title">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">{player.profession.name}</p>
          <h1 id="ledger-title">Your Ledger</h1>
        </div>
        <p className="dashboard-todo">{note || "Reckoning your books…"}</p>
      </section>
    );
  }

  const ownedById = new Map<string, OwnedBuilding>(mine.buildings.map((b) => [b.id, b]));
  const classBuilding = catalog.classBuilding;
  const ownedClass = classBuilding ? ownedById.get(classBuilding.id) : undefined;
  // Only WHOLE units are worth collecting: a good accrues continuously (closed-form
  // from its marker), so sub-1 amounts would display as "0 Wine" yet keep COLLECT
  // enabled. Gate on floor ≥ 1 (or ≥1 dr income / any owed) — the fractional remainder
  // is not lost, it keeps accruing until it crosses 1.
  const pendingGoods = Object.entries(mine.pendingGoods).filter(([, amt]) => Math.floor(amt) >= 1);
  const hasPending = pendingGoods.length > 0 || mine.pendingIncomeTotal >= 1;
  // Names always come from content.goodLabels (never a raw id).
  const label = (good: string) => catalog.goodLabels[good] ?? good[0]!.toUpperCase() + good.slice(1);
  const buildingName = (id: string) =>
    catalog.classBuilding?.id === id ? catalog.classBuilding.name : catalog.commons.find((b) => b.id === id)?.name ?? id;
  // Shipbuilder only: the class building is a craft building (data-derived).
  const canCraft = Boolean(classBuilding && Object.values(catalog.craft).some((r) => r.building === classBuilding.id));

  // Collect, then surface the full economy receipt (income, goods, wages, food, idle).
  const doCollect = async () => {
    if (pending) return;
    setPending("collect");
    setNote("");
    try {
      const r = await api.collectBuildings();
      await load();
      onRefresh();
      const parts: string[] = [];
      if (r.collected) parts.push(`+${r.collected}dr income`);
      for (const [good, amt] of Object.entries(r.banked)) parts.push(`+${Math.floor(amt)} ${label(good)}`);
      if (r.staffUpkeep) parts.push(`−${r.staffUpkeep}dr wages`);
      if (r.foodCost) parts.push(`−${r.foodCost}dr food`);
      else if (r.foodDrawn) parts.push(`${r.foodDrawn} food from stock`);
      if (r.owed) parts.push(`${r.owed}dr unpaid (forgiven)`);
      if (r.idled.length) parts.push(`idle: ${r.idled.map(buildingName).join(", ")}`);
      setNote(parts.length ? `Collected — ${parts.join(" · ")}` : "Collected — nothing due yet.");
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setPending(null);
    }
  };

  const ownedRow = (b: OwnedBuilding) => {
    const entry = b.kind === "class" ? catalog.classBuilding : catalog.commons.find((c) => c.id === b.id);
    const staffing = (entry?.tiers[b.tier - 1]?.staffing ?? {}) as Record<string, number>;
    const staffLine = staffReqLine(staffing);
    return (
    <PanelRow
      key={b.id}
      icon={b.icon ?? "🏛️"}
      title={`${b.name}${b.kind === "class" ? ` · Tier ${b.tier}` : ""}`}
      sub={
        b.status === "constructing"
          ? `under construction · ${buildCountdown(b.completesAt)}`
          : (
            <>
              {yieldSummary(b.yields, b.income, catalog.goodLabels) || (b.idle ? "earns nothing while idle" : "—")}
              {b.upkeepPerDay > 0 ? ` · upkeep ${b.upkeepPerDay}dr/day` : ""}
              {staffLine ? <><br />Staff: {staffLine}</> : null}
              {b.idle ? <><br />⚠ Idle — {idleReason(staffing, mine.pops)}</> : null}
            </>
          )
      }
      tag={b.status === "constructing" ? "building" : undefined}
      action={
        b.status === "active" && b.upgrade ? (
          <button type="button" className="panel-btn" disabled={pending === b.id} onClick={() => act(() => api.upgradeBuilding(b.id), undefined, b.id)}>
            {pending === b.id ? "Upgrading…" : `Upgrade → ${b.upgrade.name} · ${b.upgrade.cost}dr`}
          </button>
        ) : undefined
      }
    />
    );
  };

  const buildableRow = (entry: CatalogEntry, disabled?: string) => {
    const t1 = entry.tiers[0]!;
    const sub = entry.composurePerDay
      ? `+${entry.composurePerDay} composure/day (flat) · ${t1.cost}dr · ${t1.buildDays}d`
      : entry.storageBonus
        ? `+${entry.storageBonus} storage · ${t1.cost}dr · ${t1.buildDays}d`
        : `${yieldSummary(t1.yields, t1.income, catalog.goodLabels)} · ${t1.cost}dr · ${t1.buildDays}d`;
    // FEATURE 3: what it takes to build — material bill + staffing requirement.
    const matBill = Object.entries(t1.materials).map(([g, q]) => `${q} ${label(g)}`).join(" · ");
    const staffBill = staffReqLine(t1.staffing as Record<string, number>);
    const needLine = [matBill, staffBill ? `staff ${staffBill}` : ""].filter(Boolean).join(" · ");
    // BUG B: pre-check affordability (drachmae + materials + the owned-staff prereq) so
    // the player isn't allowed to click into an opaque server rejection. The shortfall
    // names exactly what's missing; the Build button is disabled until it's met. (The
    // server still validates — its message is surfaced verbatim if anything slips by.)
    const shortfalls = [
      player.drachmae < t1.cost ? `${t1.cost - player.drachmae} dr` : null,
      ...Object.entries(t1.materials).filter(([g, q]) => (player.balances[g] ?? 0) < q).map(([g, q]) => `${Math.ceil(q - (player.balances[g] ?? 0))} ${label(g)}`),
      ...Object.entries(t1.staffing as Record<string, number>).filter(([ty, q]) => (mine.pops[ty] ?? 0) < q).map(([ty, q]) => `${q - (mine.pops[ty] ?? 0)} ${popName(ty)} to staff it`),
    ].filter(Boolean) as string[];
    const blocked = shortfalls.length > 0;
    const loading = pending === entry.id;
    return (
      <PanelRow
        key={entry.id}
        icon={entry.icon ?? "🏛️"}
        title={entry.name}
        sub={
          disabled ? disabled : (
            <>
              {sub}
              {needLine ? <><br />Needs: {needLine}</> : null}
              {blocked ? <><br />⚠ Short: {shortfalls.join(" · ")}</> : null}
            </>
          )
        }
        dim={Boolean(disabled)}
        tag={disabled ? "soon" : undefined}
        action={
          disabled ? undefined : (
            <button type="button" className="panel-btn" disabled={loading || blocked} onClick={() => act(() => api.buildBuilding(entry.id), undefined, entry.id)}>
              {loading ? "Building…" : `Build · ${t1.cost}dr`}
            </button>
          )
        }
      />
    );
  };

  // Other classes have no wired class line yet: show their profession tier-1 as a
  // buildable preview, disabled until their own build lands.
  const professionTier1 = player.profession.tiers[0];

  return (
    <section className="dashboard-panel" aria-labelledby="ledger-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">{player.profession.name} · {catalog.season}</p>
        <h1 id="ledger-title">Your Ledger</h1>
        <p>Massalia · your trade, your buildings, and their income.</p>
      </div>
      <PanelBanner
        scene="your quarter of the city"
        art={assetPath("assets/Ledger.webp")}
        className="banner-hero"
      />

      {hasPending || mine.upkeepOwed > 0 ? (
        <div className="ledger-collect">
          <div>
            <strong>Ready to collect</strong>
            <div className="pr-s">
              {pendingGoods.map(([good, amt]) => `${Math.floor(amt)} ${label(good)}`).join(" · ") || "—"}
              {mine.pendingIncomeTotal >= 1 ? ` · ${Math.floor(mine.pendingIncomeTotal)}dr income` : ""}
              {mine.upkeepOwed > 0 ? ` · upkeep + wages owed ${Math.round(mine.upkeepOwed)}dr` : ""}
            </div>
          </div>
          <button type="button" className="primary-cta" disabled={busy} onClick={doCollect}>
            Collect
          </button>
        </div>
      ) : null}

      <div className="panel-label">Your Trade</div>
      {classBuilding ? (
        <ClassBuildingLadder
          entry={classBuilding}
          owned={ownedClass}
          busy={busy}
          onBuild={() => act(() => api.buildBuilding(classBuilding.id))}
          onUpgrade={() => act(() => api.upgradeBuilding(classBuilding.id))}
          goodLabels={catalog.goodLabels}
          pops={mine.pops}
          balances={player.balances}
        />
      ) : (
        <div className="panel-grid2">
          {professionTier1 ? (
            <PanelRow
              icon="🏛️"
              title={professionTier1.building}
              sub={`${professionTier1.benefit} — your class line opens in a later build`}
              dim
              tag="soon"
            />
          ) : (
            <PanelRow icon="🛠️" title="No trade line" sub="This path builds standing through the story, not buildings." />
          )}
        </div>
      )}

      {canCraft ? (
        <CraftPanel catalog={catalog} owned={ownedClass} balances={player.balances} busy={busy} onCraft={(good) => act(() => api.craftGood(good), `Crafted a ${label(good)}.`)} />
      ) : null}

      <div className="panel-label">Common Buildings</div>
      <div className="panel-grid2">
        {catalog.commons.map((entry) => {
          const owned = ownedById.get(entry.id);
          return owned ? ownedRow(owned) : buildableRow(entry);
        })}
      </div>

      {player.professionSlug === "hoplite" ? (
        <ServiceSection label={mine.classSection.label ?? "Service"} onRefresh={onRefresh} />
      ) : (
        <ClassActionsList section={mine.classSection} />
      )}

      <div className="panel-label">The Agora</div>
      <VendorDrawer catalog={catalog} busy={busy} onTrade={(action, type, qty) => act(() => api.vendorTrade(action, type, qty))} />

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
