import { useCallback, useEffect, useState, type ReactNode } from "react";
import { MARKET_PRICE_MAX, MARKET_QTY_MAX } from "@massalia/shared";
import { api, ApiError, type BuildingsCatalog, type BuildingsMine, type MarketListing, type MarketView, type VendorPrice, type PeopleView } from "../../api.js";
import { assetPath } from "../../data/league.js";
import { LobbyPortrait } from "../../lobby/LobbyPortrait.js";
import { formatDuration, GoodGlyph, HouseCrest, PanelBanner, type PanelProps, PanelRow, PopGlyph, QtyStepper } from "../shared.js";
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

type MarketTab = "goods" | "people" | "player";

// The Player market's Sell form: a held good, a whole quantity clamped to the
// floored holding (and the per-listing bound), a whole price, and the agora's band
// for that good so the seller can price against it. At the stall cap the List
// button is disabled with the reason.
function PlayerMarketSellForm({
  held,
  vendor,
  market,
  busy,
  busyKey,
  label,
  onList,
}: {
  held: { good: string; owned: number }[];
  vendor: VendorPrice[];
  market: MarketView;
  busy: boolean;
  busyKey: string | null;
  label: (good: string) => string;
  onList: (good: string, qty: number, price: number) => void;
}) {
  const [choice, setChoice] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(1);
  // A good sold out of the stores drops from the list; fall back to the first held.
  const current = held.find((h) => h.good === choice) ?? held[0] ?? null;
  const maxQty = current ? Math.min(current.owned, MARKET_QTY_MAX) : 1;
  const n = Math.min(qty, maxQty);
  const band = current ? vendor.find((v) => v.good === current.good) : undefined;
  const atCap = market.open >= market.cap;
  const disabled = busy || atCap || !current;
  return (
    <div data-testid="market-sell">
      <div className="panel-label">
        Sell <span data-testid="market-stalls">Your stalls: {market.open} of {market.cap}</span>
      </div>
      <PanelRow
        icon={current ? <GoodGlyph good={current.good} fallback="📦" /> : "📦"}
        title={
          <select aria-label="good to list" value={current?.good ?? ""} onChange={(e) => setChoice(e.target.value)} disabled={!current}>
            {held.map((h) => (
              <option key={h.good} value={h.good}>
                {label(h.good)} · own {h.owned}
              </option>
            ))}
          </select>
        }
        sub={band ? `The agora pays ${band.sell}dr · charges ${band.buy}dr` : undefined}
        action={
          <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <QtyStepper value={n} setValue={setQty} min={1} max={maxQty} />
            <input
              type="number"
              className="qty-input"
              aria-label="price per unit"
              value={price}
              min={1}
              max={MARKET_PRICE_MAX}
              step={1}
              onChange={(e) => setPrice(Math.max(1, Math.min(MARKET_PRICE_MAX, parseInt(e.target.value, 10) || 1)))}
              style={{ width: 64, textAlign: "center" }}
            />
            <button
              type="button"
              className={btnClass("panel-btn", "list", busy, busyKey, atCap || !current)}
              disabled={disabled}
              onClick={() => current && onList(current.good, n, price)}
            >
              List {n} · {price}dr each
            </button>
          </span>
        }
      />
      {atCap ? <p className="dashboard-todo">Ten stalls is the most one house may keep.</p> : null}
    </div>
  );
}

// One stall in the Player market. Another player's stall buys N, clamped to what
// remains and to what the wallet covers; the viewer's own stall shows a tag and
// Cancel instead of Buy.
function PlayerMarketStallRow({
  listing,
  wallet,
  busy,
  busyKey,
  label,
  onBuy,
  onCancel,
}: {
  listing: MarketListing;
  wallet: number;
  busy: boolean;
  busyKey: string | null;
  label: string;
  onBuy: (n: number) => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(1);
  const affordable = Math.floor(wallet / listing.price);
  const maxBuy = Math.min(listing.remaining, affordable);
  const n = Math.max(1, Math.min(qty, maxBuy));
  const { seller } = listing;
  return (
    <div data-listing={listing.id}>
      <PanelRow
        icon={<GoodGlyph good={listing.good} fallback="📦" />}
        title={`${label} · ${listing.remaining} at ${listing.price}dr`}
        sub={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <LobbyPortrait portrait={seller.portrait} faceId={seller.faceId} professionSlug={seller.professionSlug} name={seller.name} size={24} />
            {seller.name} of House {seller.houseName}
            <HouseCrest house={seller.houseSlug} />
          </span>
        }
        action={
          listing.mine ? (
            // PanelRow drops its tag when a row has an action, so the tag rides here.
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span className="pr-lvl">Your stall</span>
              <button type="button" className={btnClass("panel-btn silver", `cancel:${listing.id}`, busy, busyKey)} disabled={busy} onClick={onCancel}>
                Cancel
              </button>
            </span>
          ) : (
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <QtyStepper value={n} setValue={setQty} min={1} max={Math.max(1, maxBuy)} />
              <button
                type="button"
                className={btnClass("panel-btn", `buy:${listing.id}`, busy, busyKey, affordable < 1)}
                disabled={busy || affordable < 1}
                onClick={() => onBuy(n)}
              >
                Buy {n} · {n * listing.price}dr
              </button>
            </span>
          )
        }
      />
    </div>
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
  const [market, setMarket] = useState<MarketView | null>(null);
  // The wallet (from /me/state) bounds the Player market's Buy stepper.
  const [wallet, setWallet] = useState(0);
  // Current goods stock (type -> amount), the same balances the Inventory drawer
  // reads — used to show holdings in the row title and clamp the Sell stepper.
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<MarketTab>("goods");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  // The key of the action currently in flight (e.g. "buy:iron"), so only the
  // pressed button reads as busy while its siblings read as merely waiting.
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, m, p, s, mk] = await Promise.all([api.buildingsCatalog(), api.buildingsMine(), api.people(), api.state(), api.market()]);
    setCatalog(c);
    setMine(m);
    setPeople(p);
    setBalances(s.resources.balances);
    setWallet(s.resources.drachmae);
    setMarket(mk);
  }, []);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to open the agora."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async <R,>(key: string, fn: () => Promise<R>, ok?: string | ((result: R) => string)) => {
    setBusy(true);
    setBusyKey(key);
    setNote("");
    try {
      const result = await fn();
      await load();
      onRefresh();
      if (ok) setNote(typeof ok === "function" ? ok(result) : ok);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
      setBusyKey(null);
    }
  };

  if (!catalog || !mine || !people || !market) {
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
  // Player market: the goods held in whole units (the Sell form's choices), and the
  // stalls bucketed like the Goods tab, each bucket in the server's order.
  const heldGoods = [...catalog.vendor]
    .sort((a, b) => label(a.good).localeCompare(label(b.good)))
    .map((v) => ({ good: v.good, owned: Math.floor(balances[v.good] ?? 0) }))
    .filter((h) => h.owned >= 1);
  const stallGroups: Record<string, MarketListing[]> = { Goods: [], Materials: [], "Naval & ships": [] };
  for (const listing of market.listings) stallGroups[marketGroup(listing.good, catalog.craft)]!.push(listing);

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
      <SheetTabs<MarketTab>
        tabs={[
          { id: "goods", label: "Goods" },
          { id: "people", label: "People" },
          { id: "player", label: "Player market" },
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
      ) : tab === "player" ? (
        <>
          <p className="dashboard-todo">Citizens sell to citizens here, at their own price. The city takes one drachma in ten from every sale; Traders pay nothing.</p>
          <PlayerMarketSellForm
            held={heldGoods}
            vendor={catalog.vendor}
            market={market}
            busy={busy}
            busyKey={busyKey}
            label={label}
            onList={(good, n, p) => act("list", () => api.marketList(good, n, p), `Listed ${n} ${label(good)} at ${p}dr each.`)}
          />
          <div data-testid="market-stalls-list">
            {market.listings.length === 0 ? (
              <>
                <div className="panel-label">Stalls</div>
                <p className="dashboard-todo">No stalls yet.</p>
              </>
            ) : (
              Object.entries(stallGroups)
                .filter(([, list]) => list.length > 0)
                .map(([group, list]) => (
                  <div key={group}>
                    <div className="panel-label">{group}</div>
                    <div className="panel-grid2">
                      {list.map((listing) => (
                        <PlayerMarketStallRow
                          key={listing.id}
                          listing={listing}
                          wallet={wallet}
                          busy={busy}
                          busyKey={busyKey}
                          label={label(listing.good)}
                          onBuy={(n) => act(`buy:${listing.id}`, () => api.marketBuy(listing.id, n), (r) => `Bought ${r.qty} ${label(listing.good)} for ${r.total}dr.`)}
                          onCancel={() => act(`cancel:${listing.id}`, () => api.marketCancel(listing.id), (r) => `${r.returned} ${label(listing.good)} returned to your stores.`)}
                        />
                      ))}
                    </div>
                  </div>
                ))
            )}
          </div>
        </>
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

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
