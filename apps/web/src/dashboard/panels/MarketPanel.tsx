import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type BuildingsCatalog, type BuildingsMine, type VendorPrice, type PeopleView } from "../../api.js";
import { assetPath } from "../../data/league.js";
import { formatDuration, GoodGlyph, PanelBanner, type PanelProps, PanelRow, PopGlyph, QtyStepper } from "../shared.js";
import { SheetTabs } from "../sheets.js";

// Display-only grouping for the agora. The goods LIST is derived from the vendor
// data (so future goods appear automatically); only the bucket is a hint. The nine
// raw materials are a stable content concept; the naval line is derived from the
// craft outputs; anything else falls under "Goods".
const RAW_MATERIALS = new Set(["timber", "stone", "iron", "marble", "wool", "salt", "leather", "lead", "tin"]);
function marketGroup(good: string, craft: Record<string, unknown>): "Naval & ships" | "Materials" | "Goods" {
  if (good in craft || good === "naval-supplies") return "Naval & ships";
  if (RAW_MATERIALS.has(good)) return "Materials";
  return "Goods";
}

// While a trade is in flight EVERY action button is disabled; this only picks the
// LOOK. The pressed button reads busy (is-busy highlight); every other button —
// waiting siblings and statically-disabled ones (e.g. Sell with nothing owned)
// alike — shows the plain dim disabled look. The is-waiting class is still emitted
// for waiting siblings but now carries no styling (the CSS rule was removed), so it
// is inert and they fall through to .panel-btn:disabled.
function btnClass(base: string, myKey: string, busy: boolean, busyKey: string | null, staticDisabled = false): string {
  if (busyKey === myKey) return `${base} is-busy`;
  if (busy && !staticDisabled) return `${base} is-waiting`;
  return base;
}

// One People-market row with a quantity stepper: hire N (wallet-bounded) or
// dismiss/disband N (clamped to owned — the endpoint also rejects over-dismiss).
function PeopleMarketRow({
  pop,
  owned,
  busy,
  busyKey,
  foodLabel,
  onHire,
  onDismiss,
}: {
  pop: PeopleView["pops"][number];
  owned: number;
  busy: boolean;
  busyKey: string | null;
  foodLabel: string;
  onHire: (n: number) => void;
  onDismiss: (n: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const dismissN = Math.min(qty, owned); // never dismiss more than owned
  const refund = pop.sellBack * dismissN; // sell-back credit (slave only); 0 for the free classes
  return (
    <PanelRow
      icon={<PopGlyph type={pop.type} />}
      title={`${pop.label} · own ${owned}`}
      sub={`hire ${pop.hireCost}dr · upkeep ${pop.upkeepPerDay}dr/day · eats ${pop.foodPerDay} ${foodLabel}/day`}
      action={
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <QtyStepper value={qty} setValue={setQty} min={1} />
          {/* Refund shown only when the pop resells (slave); the free classes are released. */}
          <button type="button" className={btnClass("panel-btn silver", `dismiss:${pop.type}`, busy, busyKey, owned <= 0)} disabled={busy || owned <= 0} onClick={() => onDismiss(dismissN)}>
            {pop.dismissLabel} {dismissN}{refund > 0 ? ` · +${refund}dr` : ""}
          </button>
          <button type="button" className={btnClass("panel-btn", `hire:${pop.type}`, busy, busyKey)} disabled={busy} onClick={() => onHire(qty)}>
            Hire {qty} · {pop.hireCost * qty}dr
          </button>
        </span>
      }
    />
  );
}

// One goods-market row with a quantity stepper: buy N (wallet-bounded — the server
// 4xx surfaces to the note line, like hire) or sell N (clamped to held stock, like
// dismiss). The row title shows current holdings when the player owns any.
function GoodsMarketRow({
  price,
  held,
  busy,
  busyKey,
  label,
  icon,
  onBuy,
  onSell,
}: {
  price: VendorPrice;
  held: number;
  busy: boolean;
  busyKey: string | null;
  label: string;
  icon: ReactNode;
  onBuy: (n: number) => void;
  onSell: (n: number) => void;
}) {
  const [qty, setQty] = useState(1);
  // Balances are fractional floats from the lazy accrual; the player sees whole
  // numbers only (matching the server's floor(balance) in its over-sell guard).
  const owned = Math.floor(held);
  const sellN = Math.min(qty, owned); // never sell more than the floored holding
  return (
    <PanelRow
      icon={icon}
      title={owned > 0 ? `${label} · own ${owned}` : label}
      sub={`buy ${price.buy}dr · sell ${price.sell}dr`}
      action={
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <QtyStepper value={qty} setValue={setQty} min={1} />
          <button type="button" className={btnClass("panel-btn silver", `sell:${price.good}`, busy, busyKey, owned <= 0)} disabled={busy || owned <= 0} onClick={() => onSell(sellN)}>
            Sell {sellN} · {price.sell * sellN}dr
          </button>
          <button type="button" className={btnClass("panel-btn", `buy:${price.good}`, busy, busyKey)} disabled={busy} onClick={() => onBuy(qty)}>
            Buy {qty} · {price.buy * qty}dr
          </button>
        </span>
      }
    />
  );
}

// The retained spymaster's posture indicator + toggle (Prompt 4). Only rendered when
// a spymaster is owned. During the one-switch-per-season cooldown both buttons are
// disabled and the remaining time is shown; the current posture's button is disabled
// too (re-setting it would be a no-op). Failed switches surface the server string.
function SpymasterPostureControl({
  status,
  busy,
  busyKey,
  onSwitch,
}: {
  status: PeopleView["spymaster"];
  busy: boolean;
  busyKey: string | null;
  onSwitch: (posture: "guard" | "hunt") => void;
}) {
  const onCooldown = status.cooldownRemainingMs > 0;
  const cooldownLabel = formatDuration(Math.ceil(status.cooldownRemainingMs / 1000));
  return (
    <PanelRow
      icon={<PopGlyph type="spymaster" />}
      title={`Spymaster posture · ${status.posture === "guard" ? "Guarding the house" : "Hunting for openings"}`}
      sub={onCooldown ? `Your spymaster needs a season to redirect his web — ${cooldownLabel} left.` : "Guard both hidden channels, or hunt for openings in your own attempts (one switch per season)."}
      action={
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button
            type="button"
            className={btnClass("panel-btn", "posture:guard", busy, busyKey, onCooldown || status.posture === "guard")}
            disabled={busy || onCooldown || status.posture === "guard"}
            onClick={() => onSwitch("guard")}
          >
            Guard the house
          </button>
          <button
            type="button"
            className={btnClass("panel-btn", "posture:hunt", busy, busyKey, onCooldown || status.posture === "hunt")}
            disabled={busy || onCooldown || status.posture === "hunt"}
            onClick={() => onSwitch("hunt")}
          >
            Hunt for openings
          </button>
        </span>
      }
    />
  );
}

export default function MarketPanel({ onRefresh }: PanelProps) {
  const [catalog, setCatalog] = useState<BuildingsCatalog | null>(null);
  const [mine, setMine] = useState<BuildingsMine | null>(null);
  const [people, setPeople] = useState<PeopleView | null>(null);
  // Current goods stock (type -> amount), the same balances the Inventory drawer
  // reads — used to show holdings in the row title and clamp the Sell stepper.
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<"goods" | "people">("goods");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The key of the action currently in flight (e.g. "buy:iron"), so only the
  // pressed button reads as busy while its siblings read as merely waiting.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, m, p, s] = await Promise.all([api.buildingsCatalog(), api.buildingsMine(), api.people(), api.state()]);
    setCatalog(c);
    setMine(m);
    setPeople(p);
    setBalances(s.resources.balances);
  }, []);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to open the agora."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setBusyKey(key);
    setNote("");
    try {
      await fn();
      await load();
      onRefresh();
      if (ok) setNote(ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
      setBusyKey(null);
    }
  };

  if (!catalog || !mine || !people) {
    return (
      <section className="dashboard-panel" aria-labelledby="market-title">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">Agora</p>
          <h1 id="market-title">The Agora — Market</h1>
        </div>
        <p className="dashboard-todo">{note || "Opening the agora…"}</p>
      </section>
    );
  }

  // Names always come from content.goodLabels — never a raw id.
  const label = (good: string) => catalog.goodLabels[good] ?? good[0]!.toUpperCase() + good.slice(1);
  const groups: Record<string, VendorPrice[]> = { Goods: [], Materials: [], "Naval & ships": [] };
  for (const price of [...catalog.vendor].sort((a, b) => label(a.good).localeCompare(label(b.good)))) {
    groups[marketGroup(price.good, catalog.craft)]!.push(price);
  }

  return (
    <section className="dashboard-panel" aria-labelledby="market-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Agora · {catalog.season}</p>
        <h1 id="market-title">The Agora — Market</h1>
        <p>The NPC agora buys and sells every good at a seasonal band — it sells dear and buys cheap, so the market never deadlocks. Hire hands in the People market.</p>
      </div>
      <PanelBanner
        scene="the agora at midday"
        art={assetPath("assets/Market.webp")}
        className="banner-hero"
      />
      <SheetTabs<"goods" | "people">
        tabs={[
          { id: "goods", label: "Goods" },
          { id: "people", label: "People" },
        ]}
        active={tab}
        onSelect={setTab}
      />

      {tab === "goods" ? (
        Object.entries(groups)
          .filter(([, list]) => list.length > 0)
          .map(([group, list]) => (
            <div key={group}>
              <div className="panel-label">{group}</div>
              <div className="panel-grid2">
                {list.map((price) => (
                  <GoodsMarketRow
                    key={price.good}
                    price={price}
                    held={balances[price.good] ?? 0}
                    busy={busy}
                    busyKey={busyKey}
                    label={label(price.good)}
                    icon={<GoodGlyph good={price.good} fallback="📦" />}
                    onBuy={(n) => act(`buy:${price.good}`, () => api.vendorTrade("buy", price.good, n))}
                    onSell={(n) => act(`sell:${price.good}`, () => api.vendorTrade("sell", price.good, n))}
                  />
                ))}
              </div>
            </div>
          ))
      ) : (
        <>
          <div className="panel-label">Hire hands for your buildings</div>
          <div className="panel-grid2">
            {people.pops.map((pop) => (
              <PeopleMarketRow
                key={pop.type}
                pop={pop}
                owned={mine.pops[pop.type] ?? 0}
                busy={busy}
                busyKey={busyKey}
                foodLabel={label(people.foodGood)}
                onHire={(n) => act(`hire:${pop.type}`, () => api.hirePeople(pop.type, n), `Hired ${n} ${pop.label}.`)}
                onDismiss={(n) => act(`dismiss:${pop.type}`, () => api.dismissPeople(pop.type, n), `${pop.dismissLabel} — ${n} ${pop.label} let go.`)}
              />
            ))}
          </div>
          {(mine.pops.spymaster ?? 0) >= 1 ? (
            <>
              <div className="panel-label">Your spy network</div>
              <SpymasterPostureControl
                status={people.spymaster}
                busy={busy}
                busyKey={busyKey}
                onSwitch={(posture) =>
                  act(
                    `posture:${posture}`,
                    () => api.setSpymasterPosture(posture),
                    posture === "guard" ? "Your spymaster turns to guarding the house." : "Your spymaster turns to hunting for openings.",
                  )
                }
              />
            </>
          ) : null}
          <p className="dashboard-todo">“People” are contract hires — guards, tutors, hands for your trade. Never persons as property.</p>
        </>
      )}

      <p className="dashboard-todo">A player-to-player market (listings &amp; buy orders) arrives in a later build.</p>
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
