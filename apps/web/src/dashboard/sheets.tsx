import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type CharacterSheet as CharacterSheetData, type BuildingsCatalog, type BuildingsMine, type OwnedBuilding, type PeopleView } from "../api.js";
import { type House } from "../data/league.js";
import { type FourStats, POP_ICON, type PlayerDashboardView, PopGlyph, QtyStepper, buildCountdown, formatPerDay, ideologyReadout, idleReason } from "./shared.js";

// Everyone starts at Tier 1; real tier tracking lands with profession progression.
export const BASE_TIER_LABEL = "Tier 1";

// Emoji per resource type, used for the class store row and goods. The wallet
// (drachmae) is not a resources-table type — its coin row uses 🪙 directly.
export const resourceIcons: Record<string, string> = {
  wine: "🍷",
  wheat: "🌾",
  herbal: "🌿",
  prestige: "🏛️",
  intelligence: "🧠",
  militia: "⚔️",
  freedom: "⛓️",
  favor: "🤝",
};

// Emoji icons for the goods. Display NAMES come from content goodLabels (the same
// source the market uses) — never this map; this only supplies an icon.
export const goodsMeta: Record<string, { icon: string }> = {
  grain: { icon: "🌾" },
  oliveoil: { icon: "🫒" },
  wine: { icon: "🍷" },
  herbal: { icon: "🌿" },
  timber: { icon: "🪵" },
  chicken: { icon: "🐔" },
  bull: { icon: "🐂" },
  horse: { icon: "🐎" },
  ship: { icon: "⛵" },
};

// Resource rows that are NOT tradeable goods and must never show under Goods:
// internal accrual markers + abstract stat "stores". Everything else the player
// holds IS a good, so new goods (the nine materials, the naval line, ships) appear
// automatically — a deny-list, not a hardcoded allow-list of known goods.
export const NON_GOODS = new Set<string>([
  "building_income",
  "building_shrine",
  "building_staff",
  "prestige",
  "influence",
  "favor",
  "freedom",
  "intelligence",
  "militia",
  "devotion",
  // `gold` is pre-rebalance legacy currency-as-item — the wallet is drachmae now.
  // Current code never seeds it; only stale rows on old accounts carry it. Hide it
  // everywhere (a DB cleanup of those rows would be a separate, flagged migration).
  "gold",
]);

export function goodIcon(type: string): string {
  return goodsMeta[type]?.icon ?? "📦";
}

export const statDefs: { key: keyof FourStats; label: string }[] = [
  { key: "prestige", label: "Prestige" },
  { key: "devotion", label: "Devotion" },
  { key: "militia", label: "Militia" },
  { key: "intelligence", label: "Intelligence" },
];

// Each profession's primary (highlighted) stat. Paths whose income grants no
// stat fall back to Prestige (general standing).
export const primaryStatByProfession: Record<string, keyof FourStats> = {
  philosopher: "prestige",
  priest: "devotion",
  hetaira: "intelligence",
  hoplite: "militia",
};

export function primaryStatFor(slug: string): keyof FourStats {
  return primaryStatByProfession[slug] ?? "prestige";
}

// TODO: placeholder items until the items system exists.
export const placeholderItems = [
  { id: "tin-shipment", icon: "📦", name: "Recovered Tin Shipment", origin: 'Event reward · "The Missing Shipment" · sell or hold', action: "Sell" },
  { id: "letter-credit", icon: "📜", name: "Letter of Credit", origin: "Redeem at any Agora for 100 dr.", action: "Redeem" },
];

// TODO: placeholder units until the units system exists.
export const placeholderUnits = [
  { id: "caravan", icon: "🛡️", name: "Caravan Guards × 2", line: "Protect your trade routes · upkeep −1g/day each", tag: "hired", dim: false },
  { id: "militia", icon: "⚔️", name: "Militia × 0", line: "Trained and led by Military Leaders", tag: "—", dim: true },
];

// TODO: placeholder achievements until the achievement system exists.
export const earnedAchievements = [
  { id: "first-coin", icon: "🪙", name: "First Coin", detail: "Earn your first drachmae from your trade.", when: "Season I · Day 1" },
  { id: "name-at-court", icon: "⚖️", name: "A Name at Court", detail: "Resolve your first decision.", when: "Season I · Day 2" },
];
export const lockedAchievements = [
  { id: "archon", icon: "🏛️", name: "Archon", detail: "Be elected Archon of the League." },
  { id: "oikos", icon: "💍", name: "Oikos", detail: "Bind two Houses by marriage." },
  { id: "manumitted", icon: "⛓️", name: "Manumitted", detail: "Earn freedom as a Doulos." },
  { id: "season-survivor", icon: "🏆", name: "Season Survivor", detail: "Complete a full season." },
];

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "•••";
  const tld = domain.includes(".") ? domain.slice(domain.lastIndexOf(".")) : "";
  return `${local[0]}•••@•••${tld}`;
}

// Prefers the age portrait (which ages young -> prime at 30 -> old at 50); falls
// back through the class portrait and profession art when art is missing (the
// age portraits ship as placeholders until real PNGs land).
export function AvatarImage({ player }: { player: PlayerDashboardView }) {
  const candidates = [player.portrait, player.faceImage, player.profession.image].filter(Boolean) as string[];
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [player.portrait, player.faceImage, player.profession.image]);
  const src = candidates[idx];
  if (!src) return <span>{player.name[0]}</span>;
  return <img src={src} alt="" loading="lazy" onError={() => setIdx((current) => current + 1)} />;
}

export function SheetLabel({ children }: { children: ReactNode }) {
  return <div className="sheet-label">{children}</div>;
}

export function SheetTabs<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: T; label: string; badge?: number }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="cs-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          className={`cs-tab${active === tab.id ? " on" : ""}`}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {tab.badge ? <span className="cs-tab-badge">{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function DetailRow({
  icon,
  name,
  sub,
  tag,
  tone = "neutral",
  action,
  dim = false,
}: {
  // ReactNode so a row can show an image emblem (e.g. a pop crest), not just an emoji.
  icon: ReactNode;
  name: ReactNode;
  sub?: ReactNode;
  tag?: string;
  tone?: "asset" | "neutral" | "flaw";
  action?: ReactNode;
  dim?: boolean;
}) {
  return (
    <div className={`sheet-row${dim ? " dim" : ""}`}>
      <span className="sheet-row-ic" aria-hidden="true">{icon}</span>
      <div className="sheet-row-body">
        <strong>{name}</strong>
        {sub ? <span>{sub}</span> : null}
      </div>
      {action ? (
        <div className="sheet-row-action">{action}</div>
      ) : tag ? (
        <span className={`sheet-row-tag tone-${tone}`}>{tag}</span>
      ) : null}
    </div>
  );
}

export function ResRow({
  icon,
  name,
  sub,
  amount,
  rate,
  rateTone = "zero",
  rateTitle,
  dim = false,
}: {
  icon: string;
  name: string;
  sub?: string;
  amount: string;
  rate?: string; // omitted → no rate pill (no invented per-day number)
  rateTone?: "up" | "zero";
  rateTitle?: string;
  dim?: boolean;
}) {
  return (
    <div className={`res-row${dim ? " dim" : ""}`}>
      <span className="res-ic" aria-hidden="true">{icon}</span>
      <div className="res-n">
        {name}
        {sub ? <span className="res-sub"> · {sub}</span> : null}
      </div>
      <span className="res-amt">{amount}</span>
      {rate !== undefined ? (
        <span className={`res-rate ${rateTone}${rateTitle ? " placeholder" : ""}`} title={rateTitle}>
          {rate}
        </span>
      ) : null}
    </div>
  );
}

export function AlignmentBar({ ideology }: { ideology: number }) {
  const clamped = Math.max(-100, Math.min(100, ideology));
  const markerPct = 50 + clamped / 2; // -100 (Traditionalist) -> 0%, +100 (Reformist) -> 100%
  const readout = ideologyReadout(clamped);
  const eligibility =
    clamped >= 10
      ? "eligible for the Dynatoi"
      : clamped <= -10
        ? "eligible for the Palaioi"
        : "centrist — not yet eligible for a party";
  // Left = Traditionalist (bronze), right = Reformist (blue).
  const readoutColor = clamped < 0 ? "#c08a5e" : clamped > 0 ? "var(--dash-ref)" : "var(--dash-parchment)";
  return (
    <div className="cs-align">
      <div className="align-ends">
        <span style={{ color: "#c08a5e" }}>◀ Traditionalist</span>
        <span style={{ color: "var(--dash-ref)" }}>Reformist ▶</span>
      </div>
      <div className="align-bar" role="img" aria-label={`Ideology: ${readout}`}>
        <span className="align-tick" style={{ left: "45%" }} />
        <span className="align-center" />
        <span className="align-tick" style={{ left: "55%" }} />
        <span className="align-marker" style={{ left: `${markerPct}%` }} />
      </div>
      <p className="align-read">
        <b style={{ color: readoutColor }}>{readout}</b> · {eligibility} · your decisions move this
      </p>
    </div>
  );
}

export function BottomSheet({
  open,
  onClose,
  labelledBy,
  title,
  header,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  title?: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={sheetRef}>
        <span className="sheet-handle" aria-hidden="true" />
        <button className="sheet-close" type="button" ref={closeRef} onClick={onClose}>
          Close
        </button>
        <div className="sheet-body">
          {title ? (
            <h2 className="sheet-title" id={labelledBy}>
              {title}
            </h2>
          ) : null}
          {header}
          {children}
        </div>
      </div>
    </div>
  );
}

export function InventoryResources({ player, goodLabels }: { player: PlayerDashboardView; goodLabels: Record<string, string> | null }) {
  // Names via content goodLabels (never a raw id); capitalise as a fallback for goods
  // with no override and before the labels load.
  const label = (type: string) => goodLabels?.[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
  // "What I have": EVERY good the player holds (non-zero), minus non-goods
  // (markers/stats). Post-v2.1 the class good is just a good — it shows here like the
  // rest. Derived via a deny-list, so future goods appear automatically.
  const heldGoods = Object.entries(player.balances)
    .filter(([type, amount]) => amount > 0 && !NON_GOODS.has(type))
    .sort((a, b) => label(a[0]).localeCompare(label(b[0])));
  return (
    <div role="tabpanel">
      <div className="cap-banner">
        <div>
          <div className="cap-t">Warehouse</div>
          <div className="cap-s">Storage capacity arrives with the warehouse system</div>
        </div>
        <div className="cap-right">
          <div className="cap-s">— / — used</div>
          <div className="capbar" aria-hidden="true">
            <i style={{ width: "0%" }} />
          </div>
        </div>
      </div>
      <p className="sheet-todo">TODO: warehouse capacity is a placeholder until storage limits exist.</p>

      <SheetLabel>Coin</SheetLabel>
      {/* No per-day rate pill: accrual is lazy/closed-form (no tick), and the real
          income rate isn't on this /me/state payload — so we show no invented number. */}
      <ResRow icon="🪙" name="Drachmae" amount={player.drachmae.toLocaleString()} />

      <SheetLabel>Goods</SheetLabel>
      {heldGoods.length === 0 ? (
        <p className="sheet-todo">No goods yet — produce or buy them.</p>
      ) : (
        heldGoods.map(([type, amount]) => (
          <ResRow
            key={type}
            icon={goodIcon(type)}
            name={label(type)}
            amount={amount.toLocaleString()}
            rate="—"
            rateTone="zero"
          />
        ))
      )}
    </div>
  );
}

export function InventoryItems() {
  return (
    <div role="tabpanel">
      <SheetLabel>Items · {placeholderItems.length}</SheetLabel>
      {placeholderItems.map((item) => (
        <DetailRow
          key={item.id}
          icon={item.icon}
          name={item.name}
          sub={item.origin}
          action={
            <button className="sheet-btn" type="button" disabled title="TODO: items system not wired yet">
              {item.action}
            </button>
          }
        />
      ))}
      <div className="slot-empty">Items come from events, trade, and rewards — they are kept here.</div>
      <p className="sheet-todo">TODO: items are placeholder rows until the items system exists.</p>
    </div>
  );
}

// One Household row with a quantity stepper: dismiss/disband N (clamped to owned).
export function HouseholdRow({
  pop,
  count,
  foodName,
  busy,
  onDismiss,
}: {
  pop: PeopleView["pops"][number];
  count: number;
  foodName: string;
  busy: boolean;
  onDismiss: (n: number) => void;
}) {
  const [qty, setQty] = useState(1);
  const n = Math.min(qty, count);
  return (
    <DetailRow
      icon={<PopGlyph type={pop.type} />}
      name={`${pop.label} × ${count}`}
      sub={`upkeep ${pop.upkeepPerDay}dr/day · ${pop.foodPerDay} ${foodName}/day each`}
      action={
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <QtyStepper value={qty} setValue={setQty} min={1} max={count} />
          <button type="button" className="panel-btn ghost" disabled={busy || count <= 0} onClick={() => onDismiss(n)}>
            {pop.dismissLabel} {n}
          </button>
        </span>
      }
    />
  );
}

export function InventoryUnits({
  household,
  goodLabels,
  onChanged,
}: {
  household: { pops: Record<string, number>; people: PeopleView } | null;
  goodLabels: Record<string, string> | null;
  onChanged?: () => Promise<void> | void;
}) {
  const foodName = household ? goodLabels?.[household.people.foodGood] ?? household.people.foodGood.charAt(0).toUpperCase() + household.people.foodGood.slice(1) : "";
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  // Dismiss/disband N owned pops — no refund, just stops the upkeep. Reloads the
  // sheet payload so the count drops immediately.
  const dismiss = async (type: string, dismissLabel: string, popLabel: string, count: number) => {
    if (count <= 0) return;
    setBusy(true);
    setNote("");
    try {
      await api.dismissPeople(type, count);
      await onChanged?.();
      setNote(`${dismissLabel} — ${count} ${popLabel} let go.`);
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "That could not be done.");
    } finally {
      setBusy(false);
    }
  };
  // Owned pops (the household workforce) you hired in the Market — real data from
  // mine.pops + the people catalog (labels/upkeep/food). Only types you own show.
  const owned = household ? household.people.pops.filter((pop) => (household.pops[pop.type] ?? 0) > 0) : [];
  return (
    <div role="tabpanel">
      {owned.length > 0 ? (
        <>
          <SheetLabel>Household · {owned.reduce((n, pop) => n + (household!.pops[pop.type] ?? 0), 0)}</SheetLabel>
          {owned.map((pop) => (
            <HouseholdRow
              key={pop.type}
              pop={pop}
              count={household!.pops[pop.type] ?? 0}
              foodName={foodName}
              busy={busy}
              onDismiss={(n) => dismiss(pop.type, pop.dismissLabel, pop.label, n)}
            />
          ))}
          {note ? <p className="sheet-todo">{note}</p> : null}
        </>
      ) : null}
      <SheetLabel>Your units</SheetLabel>
      {placeholderUnits.map((unit) => (
        <DetailRow key={unit.id} icon={unit.icon} name={unit.name} sub={unit.line} tag={unit.tag} dim={unit.dim} />
      ))}
      <div className="slot-empty">
        Hire guards for protection — or befriend a Dekarchos. Armies are a Military Leader&apos;s trade.
      </div>
      <p className="sheet-todo">TODO: guards &amp; armies are placeholder rows until the units system exists.</p>
    </div>
  );
}

// The per-day economy breakdown (panel A): what you EARN and SPEND each day at the
// CURRENT buildings + staff + season, derived from the mine/catalog/people payloads
// the modal already fetches — no persisted history, no invented numbers. INCOME is
// actual drachmae ONLY; produced goods are listed separately (units/day) and never
// priced into income or net — wood isn't money until sold. Diagnostic cases (idle
// buildings with the missing-staff reason, owed shortfall) surface inline. Food
// follows the own-grain-first rule: wheat UNITS consumed, drachmae only for the
// shortfall that must be bought.
export function InventoryEconomy({ data, goodLabels }: { data: { mine: BuildingsMine; people: PeopleView; catalog: BuildingsCatalog } | null; goodLabels: Record<string, string> | null }) {
  if (!data) return <div role="tabpanel"><p className="sheet-todo">Reckoning your day's books…</p></div>;
  const { mine, people, catalog } = data;
  const label = (g: string) => goodLabels?.[g] ?? g.charAt(0).toUpperCase() + g.slice(1);
  const popUpkeep = (t: string) => people.pops.find((p) => p.type === t)?.upkeepPerDay ?? 0;
  const popFood = (t: string) => people.pops.find((p) => p.type === t)?.foodPerDay ?? 0;
  const dr = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(Math.round(n))} dr`;

  const active = mine.buildings.filter((b) => b.status === "active");
  // Live producers: active non-idle buildings AND upgrade-in-progress lines, which
  // keep producing their PRIOR tier's goods while constructing (mine() fills b.yields
  // with the live tier's output, so a non-empty yields list = producing now).
  const producing = mine.buildings.filter((b) => !b.idle && b.yields.length > 0);
  // A building's catalog tier (nominal income + staffing requirement). Unlike
  // mine.buildings.income (which the server zeroes when idle), this is staffing-
  // agnostic, so we can show an idle building's POTENTIAL income and what it lacks.
  const tierDef = (b: OwnedBuilding) => {
    const entry = b.kind === "class" ? catalog.classBuilding : catalog.commons.find((c) => c.id === b.id);
    return entry?.tiers[b.tier - 1];
  };

  // INCOME — actual DRACHMAE only. Goods are NOT money until sold (shown separately
  // below, never converted to a dr figure). Every owned income-earning building
  // appears — class AND common — active (earning), idle (0 until staffed), upgrading
  // (still earning its PRIOR tier live until the new one completes), or a fresh build
  // (0 until done). b.income from mine() is already the LIVE rate (prior tier mid-
  // upgrade), so an upgrading line contributes its real current income to the total.
  const incomeRows = mine.buildings
    .filter((b) => b.status === "active" || b.status === "constructing")
    .map((b) => {
      const td = tierDef(b);
      const income = Math.round(b.income); // live now: real when active, prior-tier while upgrading, 0 for a fresh build
      return {
        id: b.id,
        name: b.name,
        icon: b.icon ?? "🏛️",
        income,
        nominal: Math.round(td?.income ?? 0), // this tier's full rate ("when done" for an upgrade)
        idle: b.idle,
        constructing: b.status === "constructing",
        upgrading: b.status === "constructing" && income > 0, // earning prior tier mid-upgrade
        completesAt: b.completesAt,
        staffing: (td?.staffing ?? {}) as Record<string, number>,
      };
    })
    .filter((r) => r.nominal > 0 || r.income > 0); // income-earning lines only (goods-only excluded)
  const incomeTotal = incomeRows.reduce((s, r) => s + r.income, 0); // drachmae only (idle / fresh-build contribute 0)

  // GOODS produced — units/day per good, aggregated across producing buildings.
  // Shown as goods, never priced into income or net.
  const goodsAgg: Record<string, number> = {};
  for (const b of producing) for (const y of b.yields) goodsAgg[y.good] = (goodsAgg[y.good] ?? 0) + y.perDay;
  const goodsRows = Object.entries(goodsAgg).sort((a, b) => label(a[0]).localeCompare(label(b[0])));

  // EXPENSES: wages + food are charged on every OWNED pop (hiring = paying wages + feeding
  // them, staffed or not), independent of how many a building requires.
  const wages = Object.entries(mine.pops)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ type, count, drCost: count * popUpkeep(type) }));
  const wagesTotal = wages.reduce((s, w) => s + w.drCost, 0);
  const foodUnits = Object.entries(mine.pops).reduce((s, [type, count]) => s + count * popFood(type), 0);
  // Food drawn from your own wheat production first; only the shortfall is bought.
  const foodGood = people.foodGood;
  const foodCeiling = catalog.vendor.find((v) => v.good === foodGood)?.buy ?? 0; // what you pay to buy
  const wheatProduced = producing.reduce((s, b) => s + b.yields.filter((y) => y.good === foodGood).reduce((a, y) => a + y.perDay, 0), 0);
  const foodDrawn = Math.min(foodUnits, wheatProduced);
  const foodBought = Math.max(0, foodUnits - wheatProduced);
  const foodCost = foodBought * foodCeiling;
  const upkeepTotal = active.reduce((s, b) => s + b.upkeepPerDay, 0); // building upkeep (idle still owes)

  // Net is DRACHMAE income − drachmae expenses. Goods-at-floor are NOT folded in.
  const net = incomeTotal - wagesTotal - foodCost - upkeepTotal;
  const idledRows = active.filter((b) => b.idle).map((b) => ({ id: b.id, name: b.name, staffing: (tierDef(b)?.staffing ?? {}) as Record<string, number> }));
  const owed = Math.round(mine.upkeepOwed);
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  return (
    <div role="tabpanel">
      <SheetLabel>Per day · at your buildings, staff &amp; season</SheetLabel>
      {idledRows.map((r) => (
        <p key={r.id} className="sheet-gate">⚠ {r.name} idle — {idleReason(r.staffing, mine.pops)}</p>
      ))}
      {owed > 0 ? <p className="sheet-gate">Owed: {owed} dr — your purse couldn't cover upkeep + wages.</p> : null}

      <SheetLabel>Income · drachmae</SheetLabel>
      {incomeRows.length === 0 ? (
        <p className="sheet-todo">No drachmae income yet — build and staff an income trade.</p>
      ) : (
        incomeRows.map((r) => (
          <ResRow
            key={r.id}
            icon={r.icon}
            name={r.name}
            sub={
              r.upgrading
                ? `upgrading · ${buildCountdown(r.completesAt)} — earning ${r.income} dr/day now, ${r.nominal} when done`
                : r.constructing
                  ? `under construction · ${buildCountdown(r.completesAt)} — will earn ${r.nominal} dr/day`
                  : r.idle
                    ? `idle — ${idleReason(r.staffing, mine.pops)} · would earn ${r.nominal} dr/day`
                    : undefined
            }
            amount={r.idle || (r.constructing && !r.upgrading) ? "0 dr" : dr(r.income)}
          />
        ))
      )}

      {goodsRows.length > 0 ? (
        <>
          <SheetLabel>Goods produced</SheetLabel>
          {goodsRows.map(([good, perDay]) => (
            <ResRow key={`good-${good}`} icon={goodIcon(good)} name={label(good)} amount={`+${formatPerDay(perDay)}/day`} />
          ))}
        </>
      ) : null}

      <SheetLabel>Expenses</SheetLabel>
      {wages.length === 0 && foodUnits === 0 && upkeepTotal === 0 ? <p className="sheet-todo">No wages, food, or upkeep yet.</p> : null}
      {wages.map((w) => (
        <ResRow key={`wage-${w.type}`} icon={POP_ICON[w.type] ?? "👤"} name={`${cap(w.type)} wages × ${w.count}`} amount={dr(-w.drCost)} />
      ))}
      {foodUnits > 0 ? (
        <ResRow
          icon="🌾"
          name="Food"
          sub={`${formatPerDay(foodUnits)} ${label(foodGood)}/day${foodDrawn > 0 ? ` · ${formatPerDay(foodDrawn)} from your harvest` : ""}${foodBought > 0 ? ` · ${formatPerDay(foodBought)} bought` : ""}`}
          amount={foodCost > 0 ? dr(-foodCost) : "0 dr"}
        />
      ) : null}
      {upkeepTotal > 0 ? <ResRow icon="🏛️" name="Building upkeep" amount={dr(-upkeepTotal)} /> : null}

      <div className={`econ-net ${net >= 0 ? "pos" : "neg"}`}>
        <span>Net / day</span>
        <strong>{dr(net)}</strong>
      </div>
    </div>
  );
}

export type InventoryTab = "resources" | "economy" | "items" | "units";

export function InventorySheet({
  open,
  onClose,
  player,
  initialTab = "resources",
}: {
  open: boolean;
  onClose: () => void;
  player: PlayerDashboardView;
  initialTab?: InventoryTab;
}) {
  const [tab, setTab] = useState<InventoryTab>(initialTab);
  // Open to the requested tab each time the sheet opens (Resources for the inventory
  // button, Economy for the top-bar drachmae pill).
  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);
  // The mine / people / catalog payloads (not on /me/state) feed the Units household,
  // Resources names, and the Economy breakdown. Fetched once when the sheet opens.
  const [data, setData] = useState<{ mine: BuildingsMine; people: PeopleView; catalog: BuildingsCatalog } | null>(null);
  const reload = useCallback(async () => {
    const [mine, people, catalog] = await Promise.all([api.buildingsMine(), api.people(), api.buildingsCatalog()]);
    setData({ mine, people, catalog });
  }, []);
  useEffect(() => {
    if (!open) return;
    reload().catch(() => {
      /* leave the fetched sections absent on error */
    });
  }, [open, reload]);
  // Staleness guard: refetch-on-open (above) handles a fresh open, but a build
  // completes via LAZY activation (only observed on the next mine() call), so a
  // panel left OPEN across a completion would keep showing the stale "constructing"
  // payload. If the loaded payload still has a constructing building, refetch when
  // it lands (one-shot timer) — or immediately if its completion already passed
  // (a payload fetched while building, opened/seen after it finished).
  useEffect(() => {
    if (!open || !data) return;
    const dueAt = data.mine.buildings
      .filter((b) => b.status === "constructing" && b.completesAt)
      .map((b) => new Date(b.completesAt as string).getTime());
    if (dueAt.length === 0) return;
    const soonest = Math.min(...dueAt);
    const delay = soonest - Date.now();
    if (delay <= 0) {
      reload().catch(() => {}); // already done server-side → flip it to active
      return;
    }
    const t = setTimeout(() => reload().catch(() => {}), delay + 500);
    return () => clearTimeout(t);
  }, [open, data, reload]);
  const goodLabels = data?.catalog.goodLabels ?? null;
  const household = data ? { pops: data.mine.pops, people: data.people } : null;
  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="inventory-sheet-title" title="Inventory">
      <SheetTabs<InventoryTab>
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: "resources", label: "Resources" },
          { id: "economy", label: "Economy" },
          { id: "items", label: "Items", badge: placeholderItems.length },
          { id: "units", label: "Units" },
        ]}
      />
      {tab === "resources" ? <InventoryResources player={player} goodLabels={goodLabels} /> : null}
      {tab === "economy" ? <InventoryEconomy data={data} goodLabels={goodLabels} /> : null}
      {tab === "items" ? <InventoryItems /> : null}
      {tab === "units" ? <InventoryUnits household={household} goodLabels={goodLabels} onChanged={reload} /> : null}
    </BottomSheet>
  );
}

// Icon + asset/neutral/flaw tag for a trait row (old Fatty-style display).
export const traitCategoryIcons: Record<string, string> = {
  personality: "🧠",
  upbringing: "⚓",
  class: "⚔️",
  coping: "🌿",
  reputation: "🏛️",
};

export function traitTone(trait: CharacterSheetData["traits"][number]): "asset" | "neutral" | "flaw" {
  const mod = trait.statMod;
  const net = mod ? (mod.prestige ?? 0) + (mod.devotion ?? 0) + (mod.militia ?? 0) + (mod.intelligence ?? 0) : 0;
  return net > 0 ? "asset" : net < 0 ? "flaw" : "neutral";
}

export function TraitRows({ traits }: { traits: CharacterSheetData["traits"] }) {
  if (!traits.length) {
    return (
      <div className="slot-empty">Traits are earned through decisions, quests, and the life you lead — some help, some haunt.</div>
    );
  }
  return (
    <>
      {traits.map((trait) => {
        const tone = traitTone(trait);
        return (
          <DetailRow
            key={trait.id}
            icon={traitCategoryIcons[trait.category] ?? "•"}
            name={trait.name}
            sub={trait.description}
            tag={tone === "flaw" ? "flaw" : tone}
            tone={tone}
          />
        );
      })}
    </>
  );
}

export function ComposureBar({ composure, withdrawn }: { composure: number; withdrawn: boolean }) {
  const pct = Math.max(0, Math.min(100, composure));
  const tone = pct <= 20 ? "low" : pct <= 50 ? "mid" : "high";
  return (
    <div className="composure">
      <div className="composure-track">
        <span className={`composure-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="composure-read">
        <span>{pct} / 100</span>
        {withdrawn ? <span className="composure-withdrawn">⚠️ Withdrawn from public life</span> : null}
      </div>
    </div>
  );
}

export function CharacterTab({ player, sheet }: { player: PlayerDashboardView; sheet: CharacterSheetData | null }) {
  const primary = primaryStatFor(player.professionSlug);
  // Effective stats (base + trait mods) from the canonical sheet; base from the
  // sheet too, falling back to /me/state base while the sheet loads.
  const effective = sheet?.effective ?? player.stats;
  const base = sheet?.base ?? player.stats;
  // Prestige NEVER decays (reputation outlives the man) — never mark it declining.
  const declining = (key: keyof FourStats) => key !== "prestige" && player.decaying.includes(key);
  const anyDeclining = statDefs.some((stat) => declining(stat.key));
  return (
    <div role="tabpanel">
      <SheetLabel>Stats · capped at 100</SheetLabel>
      <div className="cs-stats">
        {statDefs.map((stat) => {
          const value = effective[stat.key];
          const delta = value - base[stat.key];
          const isDeclining = declining(stat.key);
          return (
            <div
              key={stat.key}
              className={`cs-stat${stat.key === primary ? " primary" : ""}${isDeclining ? " declining" : ""}`}
              title={isDeclining ? "Age is taking its toll on this stat." : delta ? `base ${base[stat.key]} · ${delta > 0 ? "+" : ""}${delta} from traits` : undefined}
            >
              <div className="cs-stat-v">
                {value}<span className="cs-stat-cap">/100</span>
                {delta ? <span className="cs-stat-delta">{delta > 0 ? `+${delta}` : delta}</span> : null}
                {isDeclining ? <span className="cs-stat-decay" aria-label="declining with age">▼</span> : null}
              </div>
              <div className="cs-stat-k">{stat.label}</div>
            </div>
          );
        })}
      </div>
      {anyDeclining ? (
        <p className="sheet-todo">Age is taking its toll — body and mind soften with the years. Prestige endures.</p>
      ) : (
        <p className="sheet-todo">Effective stats = base + trait bonuses, capped at 100.</p>
      )}

      <SheetLabel>Composure</SheetLabel>
      <ComposureBar composure={sheet?.composure ?? player.composure} withdrawn={sheet?.withdrawn ?? player.withdrawn} />

      <SheetLabel>Alignment</SheetLabel>
      <AlignmentBar ideology={player.ideology} />

      <SheetLabel>Traits · {sheet ? sheet.traits.length : "…"}</SheetLabel>
      {sheet ? <TraitRows traits={sheet.traits} /> : <div className="slot-empty">Loading traits…</div>}
    </div>
  );
}

export function AchievementsTab() {
  return (
    <div role="tabpanel">
      <SheetLabel>Earned · {earnedAchievements.length}</SheetLabel>
      <div className="ach-grid">
        {earnedAchievements.map((ach) => (
          <div className="ach" key={ach.id}>
            <span className="ach-ic" aria-hidden="true">{ach.icon}</span>
            <div>
              <div className="ach-t">{ach.name}</div>
              <div className="ach-d">{ach.detail}</div>
              <div className="ach-when">{ach.when}</div>
            </div>
          </div>
        ))}
      </div>
      <SheetLabel>Locked</SheetLabel>
      <div className="ach-grid">
        {lockedAchievements.map((ach) => (
          <div className="ach locked" key={ach.id}>
            <span className="ach-ic" aria-hidden="true">{ach.icon}</span>
            <div>
              <div className="ach-t">{ach.name}</div>
              <div className="ach-d">{ach.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="sheet-todo">TODO: achievements are placeholder until the achievement system exists.</p>
    </div>
  );
}

export function SettingsTab({ player, onLogout }: { player: PlayerDashboardView; onLogout: () => void }) {
  const [newsletter, setNewsletter] = useState(player.newsletterOptIn);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [note, setNote] = useState("");

  const toggleNewsletter = async () => {
    const next = !newsletter;
    setNewsletter(next);
    setSavingNewsletter(true);
    setNote("");
    try {
      await api.setNewsletter(next);
    } catch {
      setNewsletter(!next);
      setNote("Could not save your newsletter preference. Try again.");
    } finally {
      setSavingNewsletter(false);
    }
  };

  const stub = (label: string) => () => setNote(`TODO: ${label} is not wired yet.`);

  return (
    <div role="tabpanel">
      <SheetLabel>Account</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Email</span>
        <span className="set-r">
          <span className="set-v">{maskEmail(player.email)}</span>
          <button className="set-act" type="button" onClick={stub("changing your email")}>Change</button>
        </span>
      </div>
      <div className="settings-row">
        <span className="set-l">Password</span>
        <button className="set-act" type="button" onClick={stub("changing your password")}>Change password</button>
      </div>
      <div className="settings-row">
        <span className="set-l">Discord</span>
        <button className="set-act" type="button" onClick={stub("Discord linking")}>Link account</button>
      </div>

      <SheetLabel>Preferences</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Season updates newsletter</span>
        <button
          type="button"
          role="switch"
          aria-checked={newsletter}
          aria-label="Season updates newsletter"
          className={`toggle${newsletter ? " on" : ""}`}
          onClick={toggleNewsletter}
          disabled={savingNewsletter}
        >
          <span className="toggle-knob" aria-hidden="true" />
        </button>
      </div>
      <div className="settings-row">
        <span className="set-l">Event notifications via Discord</span>
        <span className="set-v">requires linked account</span>
      </div>

      {note ? <p className="sheet-todo" role="status">{note}</p> : null}

      <SheetLabel>Session</SheetLabel>
      <div className="settings-row">
        <span className="set-l">Signed in as {player.name}</span>
        <button className="set-act danger" type="button" onClick={onLogout}>Log out</button>
      </div>
    </div>
  );
}

export type CharacterSheetTab = "character" | "achievements" | "settings";

export function CharacterSheet({
  open,
  onClose,
  player,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  player: PlayerDashboardView;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<CharacterSheetTab>("character");
  const [sheet, setSheet] = useState<CharacterSheetData | null>(null);
  const partyChip = player.party === "Unaligned" ? "Party — chosen in-game" : player.party;

  // Pull the canonical sheet (traits + base/effective stats) each time it opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSheet(null);
    api
      .character()
      .then((result) => {
        if (!cancelled) setSheet(result.character);
      })
      .catch(() => {
        /* sheet stays null -> tab shows base stats + loading state */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      labelledBy="character-sheet-title"
      header={
        <div className="cs-head">
          <span className="cs-av"><AvatarImage player={player} /></span>
          <div className="cs-id">
            <div className="cs-nm" id="character-sheet-title">
              {player.name} <span className="cs-ep">· epithet earned later</span>
            </div>
            <div className="cs-rk">
              {player.profession.rank} · {player.profession.name} · {BASE_TIER_LABEL}
            </div>
            <div className="cs-rk">
              Age {player.currentAge} · {player.lifeStage}
              {player.deceased ? <span className="cs-deceased"> · final years</span> : null}
            </div>
            <div className="cs-chips">
              <span className="chip house">⬤ House {player.house.name} · {player.house.stance}</span>
              <span className="chip">{partyChip}</span>
            </div>
          </div>
        </div>
      }
    >
      <SheetTabs<CharacterSheetTab>
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: "character", label: "Character" },
          { id: "achievements", label: "Achievements" },
          { id: "settings", label: "Settings" },
        ]}
      />
      {tab === "character" ? <CharacterTab player={player} sheet={sheet} /> : null}
      {tab === "achievements" ? <AchievementsTab /> : null}
      {tab === "settings" ? <SettingsTab player={player} onLogout={onLogout} /> : null}
    </BottomSheet>
  );
}
