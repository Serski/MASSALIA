import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type BuildingsCatalog, type BuildingsMine, type VendorPrice, type PeopleView } from "../../api.js";
import { assetPath } from "../../data/league.js";
import { GOOD_ICON, PanelBanner, type PanelProps, PanelRow, PopGlyph, QtyStepper } from "../shared.js";
import { SheetTabs } from "../sheets.js";

// TODO: market listings are placeholder until the market service exists.
type MarketCat = "res" | "item" | "people" | "special";
const placeholderListings: {
  id: string;
  cat: MarketCat;
  icon: string;
  name: string;
  price: string;
  seller: string;
  sellerIsGame: boolean;
  action: string;
}[] = [
  { id: "tin", cat: "res", icon: "🪨", name: "Tin × 40", price: "11 g ea", seller: "Nikandros", sellerIsGame: false, action: "Buy" },
  { id: "wine", cat: "res", icon: "🍷", name: "Wine × 20", price: "15 g ea", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "wheat", cat: "res", icon: "🌾", name: "Wheat × 100", price: "9 g ea", seller: "Philippa", sellerIsGame: false, action: "Buy" },
  { id: "letter", cat: "item", icon: "📜", name: "Letter of Credit", price: "95 g", seller: "Dorieus", sellerIsGame: false, action: "Buy" },
  { id: "amphora", cat: "item", icon: "🏺", name: "Bronze Amphora set", price: "60 g", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "guard", cat: "people", icon: "🛡️", name: "Caravan Guard · contract", price: "40 g", seller: "the Agora", sellerIsGame: true, action: "Hire" },
  { id: "tutor", cat: "people", icon: "📖", name: "Tutor · for your children", price: "120 g", seller: "the Agora", sellerIsGame: true, action: "Hire" },
  { id: "expedition", cat: "special", icon: "⛵", name: "Expedition share · a long voyage", price: "500 g", seller: "the Agora", sellerIsGame: true, action: "Buy" },
  { id: "ring", cat: "special", icon: "💍", name: "Lion-seal ring · unique", price: "800 g", seller: "Kallias", sellerIsGame: false, action: "Buy" },
];

// TODO: buy orders are placeholder until the market service exists.
const placeholderBuyOrders: { id: string; icon: string; title: string; sub: string; mine: boolean }[] = [
  { id: "tin", icon: "🪨", title: "Seeking 60 Tin · 10g ea", sub: "Posted by you · partial · 22 filled", mine: true },
  { id: "wheat", icon: "🌾", title: "Seeking 30 Wheat · 8g ea", sub: "Posted by Dorieus", mine: false },
];

const marketFilters: { id: "all" | MarketCat; label: string }[] = [
  { id: "all", label: "All" },
  { id: "res", label: "Resources" },
  { id: "item", label: "Items" },
  { id: "people", label: "People" },
  { id: "special", label: "Special" },
];

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

// One People-market row with a quantity stepper: hire N (wallet-bounded) or
// dismiss/disband N (clamped to owned — the endpoint also rejects over-dismiss).
function PeopleMarketRow({
  pop,
  owned,
  busy,
  foodLabel,
  onHire,
  onDismiss,
}: {
  pop: PeopleView["pops"][number];
  owned: number;
  busy: boolean;
  foodLabel: string;
  onHire: (n: number) => void;
  onDismiss: (n: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const dismissN = Math.min(qty, owned); // never dismiss more than owned
  return (
    <PanelRow
      icon={<PopGlyph type={pop.type} />}
      title={`${pop.label} · you own ${owned}`}
      sub={`hire ${pop.hireCost}dr · upkeep ${pop.upkeepPerDay}dr/day · eats ${pop.foodPerDay} ${foodLabel}/day`}
      action={
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <QtyStepper value={qty} setValue={setQty} min={1} />
          {/* Dismiss has NO refund — it only stops the upkeep + food. */}
          <button type="button" className="panel-btn ghost" disabled={busy || owned <= 0} onClick={() => onDismiss(dismissN)}>
            {pop.dismissLabel} {dismissN}
          </button>
          <button type="button" className="panel-btn" disabled={busy} onClick={() => onHire(qty)}>
            Hire {qty} · {pop.hireCost * qty}dr
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
  const [tab, setTab] = useState<"goods" | "people">("goods");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, m, p] = await Promise.all([api.buildingsCatalog(), api.buildingsMine(), api.people()]);
    setCatalog(c);
    setMine(m);
    setPeople(p);
  }, []);
  useEffect(() => {
    let cancelled = false;
    load().catch((err) => !cancelled && setNote(err instanceof ApiError ? err.message : "Unable to open the agora."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
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
                  <PanelRow
                    key={price.good}
                    icon={GOOD_ICON[price.good] ?? "📦"}
                    title={label(price.good)}
                    sub={`buy ${price.buy}dr · sell ${price.sell}dr`}
                    action={
                      <span style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => act(() => api.vendorTrade("buy", price.good, 1))}>Buy 1</button>
                        <button type="button" className="panel-btn" disabled={busy} onClick={() => act(() => api.vendorTrade("sell", price.good, 1))}>Sell 1</button>
                      </span>
                    }
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
                foodLabel={label(people.foodGood)}
                onHire={(n) => act(() => api.hirePeople(pop.type, n), `Hired ${n} ${pop.label}.`)}
                onDismiss={(n) => act(() => api.dismissPeople(pop.type, n), `${pop.dismissLabel} — ${n} ${pop.label} let go.`)}
              />
            ))}
          </div>
          <p className="dashboard-todo">“People” are contract hires — guards, tutors, hands for your trade. Never persons as property.</p>
        </>
      )}

      <p className="dashboard-todo">A player-to-player market (listings &amp; buy orders) arrives in a later build.</p>
      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
