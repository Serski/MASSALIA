import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type BarracksOffer, type BarracksRosterRow, type BarracksUnit, type BarracksView } from "../../api.js";
import { AssetIcon, formatClock, formatDuration, GoodGlyph, type PanelProps, REGION_NAMES_SRC, useCountdownSeconds } from "../shared.js";

// The Barracks tab (military prompt ui-2). Renders the GET /api/barracks view to
// the design in docs/barracks/design/Barracks_dc.html: a summary strip, At Home
// beside Away · Returning and In Training, then the Training Ground and the
// Mercenary Market. The server is authoritative: every successful POST returns
// the next view, which replaces local state outright — no optimistic updates,
// no polling, no browser storage. Every countdown is anchored to the server's
// `now` (the payload's clock offset is applied once per payload); when a
// countdown reaches zero the view is refetched ONCE per row per crossing (the
// settle on GET flips the row ready, lands it, or resolves the contract).
//
// Hooks: every per-row hook lives in a child component; the panel's own hooks
// all sit above its loading return, so the hook order never changes.

const LOCK_REASON = (required: number, current: number) => `The barracks admit men of militia ${required}. You stand at ${current}.`;
const BAND_CAP_REASON = "Two bands is all the city will feed.";
const SERVICE_REASON = "Two seasons' service first.";
const MS_PER_DAY = 86_400_000;

// --- Text helpers ------------------------------------------------------------

// Good ids → the short names the recipe and upkeep lines use.
const GOOD_NAME: Record<string, string> = { oliveoil: "olive oil", herbal: "herbs", timber: "timber", leather: "leather", grain: "grain", wine: "wine", chicken: "chicken", drachmae: "dr" };
const goodName = (good: string) => GOOD_NAME[good] ?? good;

// A per-day line from an upkeep map in a fixed order, drachmae last:
// "2 grain · 1 oil" / "40 drachmae · 4 wine · 4 chicken · 2 herbs".
const UPKEEP_ORDER = ["grain", "oliveoil", "wine", "chicken", "herbal", "drachmae"];
const UPKEEP_NAME: Record<string, string> = { grain: "grain", oliveoil: "oil", wine: "wine", chicken: "chicken", herbal: "herbs", drachmae: "drachmae" };
function upkeepParts(map: Record<string, number>, drachmaeAs = "drachmae"): string[] {
  const keys = [...UPKEEP_ORDER.filter((g) => (map[g] ?? 0) > 0), ...Object.keys(map).filter((g) => !UPKEEP_ORDER.includes(g) && (map[g] ?? 0) > 0)];
  return keys.map((g) => `${map[g]} ${g === "drachmae" ? drachmaeAs : (UPKEEP_NAME[g] ?? goodName(g))}`);
}
function upkeepLine(map: Record<string, number>, drachmaeAs = "drachmae"): string {
  return upkeepParts(map, drachmaeAs).join(" · ");
}

// Unit upkeep for the catalogue: "1 grain, 1 oil a day".
function unitUpkeep(upkeep: Record<string, number>): string {
  return `${upkeep.grain ?? 0} grain, ${upkeep.oliveoil ?? 0} oil a day`;
}
// Band upkeep for the market: "40 dr, 4 wine, 4 chicken, 2 herbs a day" (+ grain for mounted bands).
function bandUpkeep(upkeep: Record<string, number>): string {
  const parts = [`${upkeep.drachmae ?? 0} dr`, `${upkeep.wine ?? 0} wine`, `${upkeep.chicken ?? 0} chicken`, `${upkeep.herbal ?? 0} herbs`];
  if (upkeep.grain) parts.push(`${upkeep.grain} grain`);
  return `${parts.join(", ")} a day`;
}
// The gear recipe as text: "2 timber · 1 leather".
function gearLine(gear: Record<string, number>): string {
  return Object.entries(gear)
    .map(([good, qty]) => `${qty} ${goodName(good)}`)
    .join(" · ");
}

// Shift a server-clock instant onto the device clock. useCountdownSeconds reads
// Date.now(), so counting down to (target − offset) on the device is exactly
// counting down to `target` on the server clock (Date.now() + offset).
function onDeviceClock(targetIso: string | null, offset: number): string | null {
  return targetIso ? new Date(Date.parse(targetIso) - offset).toISOString() : null;
}

// Progress of an interval on the server clock, 0..100.
function progressPct(startIso: string | null, endIso: string | null, serverNowMs: number): number {
  if (!startIso || !endIso) return 0;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!(end > start)) return 100;
  return Math.max(0, Math.min(100, Math.round(((serverNowMs - start) / (end - start)) * 100)));
}

// The instant a row may be released, derived from the payload: a trained row's
// ready_at less its training time plus the service minimum; a band's first-term
// end (its contract_end_at while canDisband is still false — renewals only move
// it once the first term is served). The server's canDisband stays authoritative.
function releaseAtIso(row: BarracksRosterRow, view: BarracksView): string | null {
  if (row.source === "band") return row.contractEndAt;
  if (!row.readyAt) return null;
  const unit = view.units.find((u) => u.id === row.unitId);
  if (!unit) return null;
  return new Date(Date.parse(row.readyAt) + (view.config.minServiceSeasons - unit.trainSeasons) * MS_PER_DAY).toISOString();
}

// What a row on the march is doing, from its mission and where it is bound:
// "Raiding Salyes", "Scouting Salyes", "Marching on Salyes" (an attack still
// bound for its target), "Marching to Salyes" (a move), or, once the party is
// bound home from a target, "Returning from Salyes". No mission: "Returning".
const MISSION_TAG: Record<NonNullable<BarracksRosterRow["mission"]>["kind"], string> = { scout: "SCOUT", raid: "RAID", attack: "ATTACK", move: "MOVE" };
export function missionLine(row: BarracksRosterRow, names: Record<string, string>): string {
  const m = row.mission;
  if (!m) return "Returning";
  const place = names[m.regionId] ?? m.regionId;
  if (row.movingTo !== m.regionId) return `Returning from ${place}`;
  switch (m.kind) {
    case "raid":
      return `Raiding ${place}`;
    case "scout":
      return `Scouting ${place}`;
    case "attack":
      return `Marching on ${place}`;
    default:
      return `Marching to ${place}`;
  }
}

// "26 of 30" when the row has lost men, else the count.
const countText = (row: BarracksRosterRow) => (row.count === row.startCount ? String(row.count) : `${row.count} of ${row.startCount}`);
const men = (rows: BarracksRosterRow[]) => rows.reduce((n, r) => n + r.count, 0);
const menText = (n: number) => `${n} ${n === 1 ? "man" : "men"}`;

// Same in-flight look as the market: the pressed button reads busy, the rest dim.
function btnClass(base: string, myKey: string, busyKey: string | null): string {
  return busyKey === myKey ? `${base} is-busy` : base;
}

// --- Small pieces -----------------------------------------------------------

function UnitGlyph({ file, fallback }: { file: string; fallback: string }) {
  return <AssetIcon file={file} alt="" className="asset-icon barracks-glyph" fallback={<span aria-hidden="true">{fallback}</span>} />;
}

function RowError({ message }: { message: string | null }) {
  return message ? <p className="barracks-row-error" role="alert">{message}</p> : null;
}

// The six stat chips: ATK DEF MSL MOR SPD SPC.
const CHIPS: [string, string][] = [["ATK", "atk"], ["DEF", "def"], ["MSL", "msl"], ["MOR", "mor"], ["SPD", "spd"], ["SPC", "space"]];
function StatChips({ stats }: { stats: Record<string, number> }) {
  return (
    <div className="barracks-chips">
      {CHIPS.map(([label, key]) => (
        <span key={key} className="barracks-chip">
          <span className="barracks-chip-k">{label}</span> <span className="barracks-chip-v">{stats[key] ?? 0}</span>
        </span>
      ))}
    </div>
  );
}

// A section heading with its rule and an optional right-hand note.
function SectionHead({ title, note }: { title: string; note?: ReactNode }) {
  return (
    <div className="barracks-head">
      <span className="barracks-head-title">{title}</span>
      <span className="barracks-head-rule" aria-hidden="true" />
      {note !== undefined ? <span className="barracks-head-note">{note}</span> : null}
    </div>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: "away" | "training" }) {
  return (
    <div className={`barracks-bar ${tone}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="barracks-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// --- Rows --------------------------------------------------------------------

// At Home: a ready trained row or a band standing at a base. Upkeep and service
// lines under the name, Disband with the inline confirm.
export function HomeRow({
  row,
  offset,
  releaseAt,
  upkeep,
  locked,
  lockReason,
  busy,
  busyKey,
  confirming,
  error,
  onConfirmChange,
  onDisband,
  onZero,
}: {
  row: BarracksRosterRow;
  offset: number;
  releaseAt: string | null;
  upkeep: { row: Record<string, number> | null; perMan: Record<string, number> | null };
  locked: boolean;
  lockReason: string;
  busy: boolean;
  busyKey: string | null;
  confirming: boolean;
  error: string | null;
  onConfirmChange: (open: boolean) => void;
  onDisband: () => void;
  onZero: (key: string) => void;
}) {
  // A band counts down to its contract end; the service countdown runs only
  // while canDisband is false. Each crossing refetches once.
  const contractTarget = row.source === "band" ? row.contractEndAt : null;
  const contractLeft = useCountdownSeconds(onDeviceClock(contractTarget, offset));
  const serviceTarget = row.canDisband ? null : releaseAt;
  const serviceLeft = useCountdownSeconds(onDeviceClock(serviceTarget, offset));
  useEffect(() => {
    if (contractTarget && contractLeft <= 0) onZero(`${row.id}:${contractTarget}`);
  }, [row.id, contractTarget, contractLeft, onZero]);
  useEffect(() => {
    if (serviceTarget && serviceLeft <= 0) onZero(`${row.id}:release:${serviceTarget}`);
  }, [row.id, serviceTarget, serviceLeft, onZero]);

  const eats = upkeep.row
    ? row.source === "band"
      ? `${upkeepLine(upkeep.row)} a day${contractTarget ? ` · contract ${formatDuration(contractLeft)}` : ""}`
      : `${upkeep.perMan ? `${upkeepLine(upkeep.perMan)} a day per man · ` : ""}${upkeepLine(upkeep.row)} for the row`
    : row.source === "band" && contractTarget
      ? `contract ${formatDuration(contractLeft)}`
      : "";
  const service = row.canDisband ? "May be released." : serviceTarget && serviceLeft > 0 ? `${SERVICE_REASON} ${formatDuration(serviceLeft)} to go.` : SERVICE_REASON;
  const disabledReason = locked ? lockReason : row.canDisband ? null : service;

  let action: ReactNode;
  if (confirming) {
    action = (
      <span className="barracks-actions">
        <button type="button" className={btnClass("panel-btn danger", `disband:${row.id}`, busyKey)} disabled={busy} onClick={onDisband}>
          Confirm — disband {row.count}
        </button>
        <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => onConfirmChange(false)}>Cancel</button>
      </span>
    );
  } else {
    action = (
      <button type="button" className="panel-btn ghost barracks-small" disabled={busy || disabledReason !== null} title={disabledReason ?? undefined} onClick={() => onConfirmChange(true)}>
        Disband
      </button>
    );
  }
  return (
    <div className="barracks-row" data-row={row.id}>
      <div className="barracks-row-grid">
        <span className="barracks-row-ic"><UnitGlyph file={row.icon} fallback={row.source === "band" ? "⚔️" : "🛡️"} /></span>
        <div className="barracks-row-body">
          <div className="barracks-row-name">{row.label} <span className="barracks-row-count">· {countText(row)}</span></div>
          {eats ? <div className="barracks-row-sub">{eats}</div> : null}
          <div className="barracks-row-service">{service}</div>
        </div>
        {action}
      </div>
      <RowError message={error} />
    </div>
  );
}

// Away · Returning: a row on the march, counting down to its arrival with its
// mission line, a progress bar and a kind tag.
export function AwayRow({ row, names, offset, serverNowMs, onZero }: { row: BarracksRosterRow; names: Record<string, string>; offset: number; serverNowMs: number; onZero: (key: string) => void }) {
  const target = row.arrivesAt;
  const left = useCountdownSeconds(onDeviceClock(target, offset));
  useEffect(() => {
    if (target && left <= 0) onZero(`${row.id}:march:${target}`);
  }, [row.id, target, left, onZero]);
  const pct = row.mission ? progressPct(row.mission.departedAt, row.arrivesAt, serverNowMs) : null;
  return (
    <div className="barracks-row barracks-away" data-row={row.id}>
      <div className="barracks-row-grid two">
        <div className="barracks-row-body">
          <div className="barracks-row-name split">
            <span>{row.label} <span className="barracks-row-count">· {countText(row)}</span></span>
            <span className="barracks-row-left">{formatClock(left)}</span>
          </div>
          <div className="barracks-row-sub barracks-mission">{missionLine(row, names)}</div>
          {pct !== null ? <ProgressBar pct={pct} tone="away" /> : null}
        </div>
        {row.mission ? <span className="barracks-tag">{MISSION_TAG[row.mission.kind]}</span> : null}
      </div>
    </div>
  );
}

// In Training: counting down to ready_at with a progress bar and Cancel.
export function TrainingRow({
  row,
  offset,
  serverNowMs,
  busy,
  busyKey,
  confirming,
  error,
  onConfirmChange,
  onCancel,
  onZero,
}: {
  row: BarracksRosterRow;
  offset: number;
  serverNowMs: number;
  busy: boolean;
  busyKey: string | null;
  confirming: boolean;
  error: string | null;
  onConfirmChange: (open: boolean) => void;
  onCancel: () => void;
  onZero: (key: string) => void;
}) {
  const target = row.readyAt;
  const left = useCountdownSeconds(onDeviceClock(target, offset));
  useEffect(() => {
    if (target && left <= 0) onZero(`${row.id}:${target}`);
  }, [row.id, target, left, onZero]);
  const pct = progressPct(row.createdAt, row.readyAt, serverNowMs);
  return (
    <div className="barracks-row barracks-training" data-row={row.id}>
      <div className="barracks-row-grid two">
        <div className="barracks-row-body">
          <div className="barracks-row-name split">
            <span>{row.label} <span className="barracks-row-count">· {countText(row)}</span></span>
            <span className="barracks-row-left">{formatClock(left)}</span>
          </div>
          <ProgressBar pct={pct} tone="training" />
        </div>
        {confirming ? (
          <span className="barracks-actions">
            <button type="button" className={btnClass("panel-btn danger", `cancel:${row.id}`, busyKey)} disabled={busy} onClick={onCancel}>
              Confirm — stand down {row.count}
            </button>
            <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => onConfirmChange(false)}>Keep</button>
          </span>
        ) : (
          <button type="button" className="panel-btn ghost barracks-small" disabled={busy} onClick={() => onConfirmChange(true)}>Cancel</button>
        )}
      </div>
      <RowError message={error} />
    </div>
  );
}

// Training Ground: one card per unit with the stepper and Recruit n.
export function UnitCard({
  unit,
  levyMax,
  locked,
  lockReason,
  busy,
  busyKey,
  error,
  onRecruit,
}: {
  unit: BarracksUnit;
  levyMax: number;
  locked: boolean;
  lockReason: string;
  busy: boolean;
  busyKey: string | null;
  error: string | null;
  onRecruit: (count: number) => void;
}) {
  const max = Math.max(1, levyMax);
  const [qty, setQty] = useState(1);
  const clamp = (n: number) => Math.max(1, Math.min(max, Number.isFinite(n) ? n : 1));
  const n = clamp(qty);
  return (
    <div className="barracks-card" data-unit={unit.id}>
      <div className="barracks-card-id">
        <span className="barracks-row-ic"><UnitGlyph file={unit.icon} fallback="🛡️" /></span>
        <div>
          <div className="barracks-card-name">{unit.label}</div>
          <div className="barracks-card-role">{unit.role}</div>
        </div>
      </div>
      <div className="barracks-card-body">
        <StatChips stats={unit.stats} />
        <div className="barracks-card-line">
          <span className="barracks-k">Gear</span> {gearLine(unit.gear)} <span className="barracks-sep">|</span>
          <span className="barracks-k">Upkeep</span> {unitUpkeep(unit.upkeepPerDay)} <span className="barracks-sep">|</span>
          <span className="barracks-k">Trains</span> {unit.trainSeasons * 24}h
        </div>
        <div className="barracks-card-gear">
          {Object.entries(unit.gear).map(([good, q]) => (
            <span key={good} className="barracks-gear-item"><GoodGlyph good={good} fallback="📦" /> {q}</span>
          ))}
        </div>
      </div>
      <div className="barracks-stepper">
        <button type="button" className="panel-btn ghost barracks-step" aria-label={`fewer ${unit.plural}`} disabled={busy || n <= 1} onClick={() => setQty(clamp(n - 1))}>−</button>
        <input type="number" className="qty-input barracks-qty" min={1} max={max} value={n} aria-label={`men to recruit as ${unit.label}`} disabled={busy} onChange={(e) => setQty(clamp(parseInt(e.target.value, 10)))} />
        <button type="button" className="panel-btn ghost barracks-step" aria-label={`more ${unit.plural}`} disabled={busy || n >= max} onClick={() => setQty(clamp(n + 1))}>+</button>
        <button type="button" className={btnClass("panel-btn", `recruit:${unit.id}`, busyKey)} disabled={busy || locked} title={locked ? lockReason : undefined} onClick={() => onRecruit(n)}>
          Recruit {n}
        </button>
      </div>
      <RowError message={error} />
    </div>
  );
}

// Mercenary Market: one card per offer.
export function OfferCard({
  offer,
  termSeasons,
  locked,
  lockReason,
  capped,
  busy,
  busyKey,
  error,
  onHire,
}: {
  offer: BarracksOffer;
  termSeasons: number;
  locked: boolean;
  lockReason: string;
  capped: boolean;
  busy: boolean;
  busyKey: string | null;
  error: string | null;
  onHire: () => void;
}) {
  const disabledReason = locked ? lockReason : capped ? BAND_CAP_REASON : null;
  return (
    <div className="barracks-card" data-offer={offer.id}>
      <div className="barracks-card-id wide">
        <span className="barracks-row-ic"><UnitGlyph file={offer.icon} fallback="⚔️" /></span>
        <div>
          <div className="barracks-card-name">{offer.label}</div>
          <div className="barracks-card-role">{offer.men} men · {offer.role}</div>
        </div>
      </div>
      <div className="barracks-card-body">
        <StatChips stats={offer.stats} />
        <div className="barracks-card-line">
          <span className="barracks-k">Upkeep</span> {bandUpkeep(offer.upkeepPerDay)} <span className="barracks-sep">|</span>
          <span className="barracks-k">Contract</span> {termSeasons * 24}h
        </div>
      </div>
      <div className="barracks-actions barracks-card-actions">
        {offer.hired ? (
          <span className="barracks-hired">● Hired</span>
        ) : (
          <>
            {disabledReason && !locked ? <span className="barracks-why">{disabledReason}</span> : null}
            <button type="button" className={btnClass("panel-btn", `hire:${offer.id}`, busyKey)} disabled={busy || disabledReason !== null} title={disabledReason ?? undefined} onClick={onHire}>
              Hire
            </button>
          </>
        )}
      </div>
      <RowError message={error} />
    </div>
  );
}

// --- The panel ---------------------------------------------------------------

export default function BarracksPanel({ player, onRefresh }: PanelProps) {
  const [view, setView] = useState<BarracksView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // One inline error at a time, under the row whose action failed.
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Region display names for the mission lines (the map's public names file).
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch(REGION_NAMES_SRC)
      .then((r) => r.json() as Promise<{ names?: Record<string, string> }>)
      .then((file) => setNames(file.names ?? {}))
      .catch(() => {});
  }, []);
  // Countdown crossings already answered with a refetch (row id + target instant),
  // so a timer sitting at zero never refetches twice.
  const refetched = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoadError("");
    try {
      setView(await api.barracks());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "The barracks could not be reached.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Every action: send intent, replace the view with the server's response, and
  // refresh the header (drachmae, resources). Failures surface the server line
  // under the row that asked.
  const act = async (key: string, fn: () => Promise<BarracksView>, ok: string) => {
    setBusy(true);
    setBusyKey(key);
    setNote("");
    setRowError(null);
    try {
      const next = await fn();
      setView(next);
      setConfirmId(null);
      onRefresh();
      setNote(ok);
    } catch (err) {
      setRowError({ key, message: err instanceof ApiError ? err.message : "That could not be done." });
    } finally {
      setBusy(false);
      setBusyKey(null);
    }
  };
  const errorFor = (key: string) => (rowError?.key === key ? rowError.message : null);

  const onZero = useCallback(
    (key: string) => {
      if (refetched.current.has(key)) return;
      refetched.current.add(key);
      void load();
    },
    [load],
  );

  // Clock offset, once per payload: server now − device now. Every countdown
  // and progress bar derives from Date.now() + offset.
  const offset = useMemo(() => (view ? Date.parse(view.now) - Date.now() : 0), [view]);
  const serverNowMs = view ? Date.parse(view.now) : Date.now();

  if (!view) {
    return (
      <section className="dashboard-panel" aria-labelledby="barracks-title">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">Barracks · {player.gameDateLabel}</p>
          <h1 id="barracks-title">The Barracks</h1>
        </div>
        {loadError ? (
          <p className="dashboard-todo" role="alert">
            {loadError}{" "}
            <button type="button" className="panel-btn ghost" onClick={() => void load()}>Try again</button>
          </p>
        ) : (
          <p className="dashboard-todo">Opening the barracks…</p>
        )}
      </section>
    );
  }

  const locked = !view.gate.met;
  const lockReason = LOCK_REASON(view.gate.required, view.gate.current);
  const capped = view.activeBands >= view.config.maxActiveBands;

  // The roster in its three places.
  const away = view.roster.filter((r) => r.movingTo !== null);
  const training = view.roster.filter((r) => r.source === "trained" && !r.active && r.movingTo === null);
  const home = view.roster.filter((r) => r.movingTo === null && r.active);
  const homeLevy = home.filter((r) => r.source === "trained");
  const homeBands = home.filter((r) => r.source === "band");
  const upkeepFor = (row: BarracksRosterRow) => ({ row: view.upkeep.rows[row.id] ?? null, perMan: row.source === "trained" ? (view.units.find((u) => u.id === row.unitId)?.upkeepPerDay ?? null) : null });
  const strip = upkeepLine(view.upkeep.perDay, "dr");
  const bandsInCity = view.offers.length === 3 ? "Three" : String(view.offers.length);

  return (
    <section className="dashboard-panel barracks-panel" aria-labelledby="barracks-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Barracks · {player.gameDateLabel}</p>
        <h1 id="barracks-title">The Barracks</h1>
      </div>

      {locked ? (
        <div className="barracks-lock" role="status">
          <span className="barracks-lock-ic" aria-hidden="true">🔒</span>
          <p>{lockReason}</p>
        </div>
      ) : null}

      <div className="barracks-strip" data-testid="summary">
        <div className="barracks-cell">
          <span className="barracks-k">Levy</span>
          <span className="barracks-big">{view.summary.underArms} <small>of {view.summary.underArms + view.summary.levyMen} under arms</small></span>
        </div>
        <div className="barracks-cell">
          <span className="barracks-k">Come of age</span>
          <span className="barracks-big">+{view.summary.growthPerYear} <small>each year</small></span>
        </div>
        <div className="barracks-cell">
          <span className="barracks-k">Daily upkeep</span>
          <span className="barracks-big barracks-big-text">{strip || "nothing yet"}</span>
        </div>
      </div>

      <div className="barracks-columns">
        <section className="barracks-section" data-section="home" aria-label="At home">
          <SectionHead title="At home" note={menText(men(home))} />
          <div className="barracks-list">
            <div className="barracks-list-head">Levy · {menText(men(homeLevy))}</div>
            {homeLevy.length === 0 ? <p className="barracks-empty">No men under arms.</p> : null}
            {homeLevy.map((row) => (
              <HomeRow
                key={row.id}
                row={row}
                offset={offset}
                releaseAt={releaseAtIso(row, view)}
                upkeep={upkeepFor(row)}
                locked={locked}
                lockReason={lockReason}
                busy={busy}
                busyKey={busyKey}
                confirming={confirmId === row.id}
                error={errorFor(`disband:${row.id}`)}
                onConfirmChange={(open) => setConfirmId(open ? row.id : null)}
                onDisband={() => act(`disband:${row.id}`, () => api.barracksDisband(row.id), `Disbanded the ${row.plural}.`)}
                onZero={onZero}
              />
            ))}
            <div className="barracks-list-head">Mercenaries · {menText(men(homeBands))}</div>
            {homeBands.length === 0 ? <p className="barracks-empty">No bands under contract.</p> : null}
            {homeBands.map((row) => (
              <HomeRow
                key={row.id}
                row={row}
                offset={offset}
                releaseAt={releaseAtIso(row, view)}
                upkeep={upkeepFor(row)}
                locked={locked}
                lockReason={lockReason}
                busy={busy}
                busyKey={busyKey}
                confirming={confirmId === row.id}
                error={errorFor(`disband:${row.id}`)}
                onConfirmChange={(open) => setConfirmId(open ? row.id : null)}
                onDisband={() => act(`disband:${row.id}`, () => api.barracksDisband(row.id), `Disbanded the ${row.label}.`)}
                onZero={onZero}
              />
            ))}
          </div>
        </section>

        <div className="barracks-stack">
          <section className="barracks-section" data-section="away" aria-label="Away, returning">
            <SectionHead title="Away · Returning" note={menText(men(away))} />
            <div className="barracks-list away">
              {away.length === 0 ? <p className="barracks-empty">No one on the march.</p> : null}
              {away.map((row) => (
                <AwayRow key={row.id} row={row} names={names} offset={offset} serverNowMs={serverNowMs} onZero={onZero} />
              ))}
            </div>
          </section>

          <section className="barracks-section" data-section="training" aria-label="In training">
            <SectionHead title="In training" note={menText(men(training))} />
            <div className="barracks-list training">
              {training.length === 0 ? <p className="barracks-empty">No one drilling.</p> : null}
              {training.map((row) => (
                <TrainingRow
                  key={row.id}
                  row={row}
                  offset={offset}
                  serverNowMs={serverNowMs}
                  busy={busy}
                  busyKey={busyKey}
                  confirming={confirmId === row.id}
                  error={errorFor(`cancel:${row.id}`)}
                  onConfirmChange={(open) => setConfirmId(open ? row.id : null)}
                  onCancel={() => act(`cancel:${row.id}`, () => api.barracksCancel(row.id), `Stood down ${row.count} ${row.count === 1 ? row.label.toLowerCase() : row.plural.toLowerCase()}.`)}
                  onZero={onZero}
                />
              ))}
            </div>
          </section>
        </div>
      </div>

      <section className="barracks-section" data-section="training-ground" aria-label="Training ground">
        <SectionHead title="Training ground" />
        <div className="barracks-list">
          {view.units.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              levyMax={view.levy.men}
              locked={locked}
              lockReason={lockReason}
              busy={busy}
              busyKey={busyKey}
              error={errorFor(`recruit:${unit.id}`)}
              onRecruit={(count) => act(`recruit:${unit.id}`, () => api.barracksRecruit(unit.id, count), `Recruited ${count} ${count === 1 ? unit.label.toLowerCase() : unit.plural.toLowerCase()}.`)}
            />
          ))}
        </div>
      </section>

      <section className="barracks-section" data-section="market" aria-label="Mercenary market">
        <SectionHead title="Mercenary market" note={`${bandsInCity} bands in the city · ${view.activeBands} of ${view.config.maxActiveBands} under contract`} />
        <div className="barracks-list">
          {view.offers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              termSeasons={view.config.termSeasons}
              locked={locked}
              lockReason={lockReason}
              capped={capped}
              busy={busy}
              busyKey={busyKey}
              error={errorFor(`hire:${offer.id}`)}
              onHire={() => act(`hire:${offer.id}`, () => api.barracksHire(offer.id), `Hired the ${offer.label}.`)}
            />
          ))}
        </div>
      </section>

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
