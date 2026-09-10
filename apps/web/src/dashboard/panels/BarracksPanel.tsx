import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type BarracksOffer, type BarracksRosterRow, type BarracksUnit, type BarracksView } from "../../api.js";
import { AssetIcon, DashboardCard, formatDuration, GoodGlyph, type PanelProps, PanelRow, QtyStepper, useCountdownSeconds } from "../shared.js";

// The Barracks tab (military prompt 2). Renders the GET /api/barracks view and
// sends recruit / hire / disband intents. The server is authoritative: every
// successful POST returns the next view, which replaces local state outright —
// no optimistic updates, no polling, no browser storage. Unit and band data
// reach this panel only through the API payload.
//
// Timers: training and contracts are durations (readyAt / contractEndAt, ISO)
// and every countdown is anchored to the server's `now` — the payload's clock
// offset is applied once per payload so a wrong device clock cannot skew them.
// When a countdown reaches zero the view is refetched ONCE per row per crossing
// (the settle on GET flips the row ready or resolves the contract).

const LOCK_REASON = (required: number, current: number) => `The barracks admit men of militia ${required}. You stand at ${current}.`;
const BAND_CAP_REASON = "Two bands is all the city will feed.";
const SERVICE_REASON = "Two seasons' service first.";

// Good ids → the short names the recipe and upkeep lines use.
const GOOD_NAME: Record<string, string> = { oliveoil: "olive oil", herbal: "herbs", timber: "timber", leather: "leather", grain: "grain", wine: "wine", chicken: "chicken", drachmae: "dr" };
const goodName = (good: string) => GOOD_NAME[good] ?? good;

function statsLine(stats: Record<string, number>): string {
  const n = (k: string) => stats[k] ?? 0;
  return `Atk ${n("atk")} · Def ${n("def")} · Msl ${n("msl")} · Mor ${n("mor")} · Spd ${n("spd")} · Space ${n("space")}`;
}

const MS_PER_DAY = 86_400_000;

// hh:mm:ss, with a days prefix past 24h: "22:14:07", "1d 03:12:44".
function clock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const d = Math.floor(s / 86400);
  const rest = s % 86400;
  const hh = String(Math.floor(rest / 3600)).padStart(2, "0");
  const mm = String(Math.floor((rest % 3600) / 60)).padStart(2, "0");
  const ss = String(rest % 60).padStart(2, "0");
  return d > 0 ? `${d}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`;
}

// Shift a server-clock instant onto the device clock. useCountdownSeconds reads
// Date.now(), so counting down to (target − offset) on the device is exactly
// counting down to `target` on the server clock (Date.now() + offset).
function onDeviceClock(targetIso: string | null, offset: number): string | null {
  return targetIso ? new Date(Date.parse(targetIso) - offset).toISOString() : null;
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

// Unit upkeep: "Upkeep 1 grain, 1 oil a day".
function unitUpkeep(upkeep: Record<string, number>): string {
  return `Upkeep ${upkeep.grain ?? 0} grain, ${upkeep.oliveoil ?? 0} oil a day`;
}

// Band upkeep: "Upkeep 40 dr, 4 wine, 4 chicken, 2 herbs a day" (+ grain for mounted bands).
function bandUpkeep(upkeep: Record<string, number>): string {
  const parts = [`${upkeep.drachmae ?? 0} dr`, `${upkeep.wine ?? 0} wine`, `${upkeep.chicken ?? 0} chicken`, `${upkeep.herbal ?? 0} herbs`];
  if (upkeep.grain) parts.push(`${upkeep.grain} grain`);
  return `Upkeep ${parts.join(", ")} a day`;
}

function UnitGlyph({ file, fallback }: { file: string; fallback: string }) {
  return <AssetIcon file={file} alt="" className="asset-icon barracks-glyph" fallback={<span aria-hidden="true">{fallback}</span>} />;
}

// The gear recipe as good artwork + quantity, e.g. [wood] 2 timber · [leather] 1 leather.
function GearLine({ gear }: { gear: Record<string, number> }) {
  const entries = Object.entries(gear);
  if (entries.length === 0) return null;
  return (
    <span className="barracks-gear">
      Gear{" "}
      {entries.map(([good, qty]) => (
        <span key={good} className="barracks-gear-item">
          <GoodGlyph good={good} fallback="📦" /> {qty} {goodName(good)}
        </span>
      ))}
    </span>
  );
}

// Same in-flight look as the market: the pressed button reads busy, the rest dim.
function btnClass(base: string, myKey: string, busyKey: string | null): string {
  return busyKey === myKey ? `${base} is-busy` : base;
}

function RowError({ message }: { message: string | null }) {
  return message ? <p className="barracks-row-error" role="alert">{message}</p> : null;
}

function UnitRow({
  unit,
  locked,
  lockReason,
  busy,
  busyKey,
  error,
  onRecruit,
}: {
  unit: BarracksUnit;
  locked: boolean;
  lockReason: string;
  busy: boolean;
  busyKey: string | null;
  error: string | null;
  onRecruit: (count: number) => void;
}) {
  const [qty, setQty] = useState(1);
  return (
    <div className="barracks-unit">
      <PanelRow
        icon={<UnitGlyph file={unit.icon} fallback="🛡️" />}
        title={`${unit.label} · ${unit.role}`}
        sub={
          <>
            <GearLine gear={unit.gear} />
            <br />
            {unitUpkeep(unit.upkeepPerDay)}
            <br />
            {statsLine(unit.stats)}
            <br />
            Trains in {unit.trainSeasons * 24}h
          </>
        }
        action={
          <span className="barracks-actions">
            <QtyStepper value={qty} setValue={setQty} min={1} />
            <button
              type="button"
              className={btnClass("panel-btn", `recruit:${unit.id}`, busyKey)}
              disabled={busy || locked}
              title={locked ? lockReason : undefined}
              onClick={() => onRecruit(qty)}
            >
              Recruit {qty}
            </button>
          </span>
        }
      />
      <RowError message={error} />
    </div>
  );
}

function OfferRow({
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
  const sub = (
    <>
      {offer.men} men · {offer.role}
      <br />
      {bandUpkeep(offer.upkeepPerDay)}
      <br />
      {statsLine(offer.stats)}
      <br />
      Contract {termSeasons * 24}h
    </>
  );
  return (
    <div className="barracks-unit">
      {offer.hired ? (
        <PanelRow icon={<UnitGlyph file={offer.icon} fallback="⚔️" />} title={offer.label} sub={sub} tag="Hired" />
      ) : (
        <PanelRow
          icon={<UnitGlyph file={offer.icon} fallback="⚔️" />}
          title={offer.label}
          sub={sub}
          action={
            <span className="barracks-actions">
              {disabledReason && !locked ? <span className="barracks-why">{disabledReason}</span> : null}
              <button
                type="button"
                className={btnClass("panel-btn", `hire:${offer.id}`, busyKey)}
                disabled={busy || disabledReason !== null}
                title={disabledReason ?? undefined}
                onClick={onHire}
              >
                Hire
              </button>
            </span>
          }
        />
      )}
      <RowError message={error} />
    </div>
  );
}

function RosterRow({
  row,
  offset,
  releaseAt,
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
  // The status countdown: a band to its contract end, a trained row to ready_at
  // (none once ready). The service countdown runs only while canDisband is false.
  const timerTarget = row.source === "band" ? row.contractEndAt : row.active ? null : row.readyAt;
  const timerLeft = useCountdownSeconds(onDeviceClock(timerTarget, offset));
  const serviceTarget = row.canDisband ? null : releaseAt;
  const serviceLeft = useCountdownSeconds(onDeviceClock(serviceTarget, offset));
  useEffect(() => {
    if (timerTarget && timerLeft <= 0) onZero(`${row.id}:${timerTarget}`);
  }, [row.id, timerTarget, timerLeft, onZero]);
  useEffect(() => {
    if (serviceTarget && serviceLeft <= 0) onZero(`${row.id}:release:${serviceTarget}`);
  }, [row.id, serviceTarget, serviceLeft, onZero]);

  const status = row.source === "band" ? `Contract · ${clock(timerLeft)}` : row.active ? "Ready" : `Training · ${clock(timerLeft)}`;
  const serviceReason = serviceTarget && serviceLeft > 0 ? `${SERVICE_REASON} ${formatDuration(serviceLeft)} to go.` : SERVICE_REASON;
  const disabledReason = locked ? lockReason : row.canDisband ? null : serviceReason;
  const count = row.count === row.startCount ? String(row.count) : `${row.count} of ${row.startCount}`;
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
      <span className="barracks-actions">
        {disabledReason && !locked ? <span className="barracks-why">{disabledReason}</span> : null}
        <button
          type="button"
          className="panel-btn ghost"
          disabled={busy || disabledReason !== null}
          title={disabledReason ?? undefined}
          onClick={() => onConfirmChange(true)}
        >
          Disband
        </button>
      </span>
    );
  }
  return (
    <div className="barracks-unit">
      <PanelRow
        icon={<UnitGlyph file={row.icon} fallback={row.source === "band" ? "⚔️" : "🛡️"} />}
        title={`${row.label} · ${count}`}
        sub={status}
        action={action}
      />
      <RowError message={error} />
    </div>
  );
}

export default function BarracksPanel({ onRefresh }: PanelProps) {
  const [view, setView] = useState<BarracksView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [note, setNote] = useState("");
  // One inline error at a time, under the row whose action failed.
  const [rowError, setRowError] = useState<{ key: string; message: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
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
  // derives from Date.now() + offset.
  const offset = useMemo(() => (view ? Date.parse(view.now) - Date.now() : 0), [view]);

  if (!view) {
    return (
      <section className="dashboard-panel" aria-labelledby="barracks-title">
        <div className="dashboard-panel-heading">
          <p className="section-eyebrow">Barracks</p>
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
  const underArms = view.roster.filter((r) => r.source === "trained").reduce((n, r) => n + r.count, 0);
  const roster = [...view.roster].sort((a, b) => (a.source === b.source ? 0 : a.source === "trained" ? -1 : 1));

  return (
    <section className="dashboard-panel" aria-labelledby="barracks-title">
      <div className="dashboard-panel-heading">
        <p className="section-eyebrow">Barracks · season {view.season}</p>
        <h1 id="barracks-title">The Barracks</h1>
        <p>Raise men from your levy or hire bands passing through the city. They eat every day whether they march or not.</p>
      </div>

      {locked ? (
        <div className="barracks-lock" role="status">
          <span className="barracks-lock-ic" aria-hidden="true">🔒</span>
          <p>{lockReason}</p>
        </div>
      ) : null}

      <DashboardCard>
        <div className="panel-label">Levy</div>
        <p className="barracks-copy">
          Your oikos can field {view.levy.men} men. Ten more come of age each year.
          {underArms > 0 ? ` ${underArms} under arms.` : ""}
        </p>
      </DashboardCard>

      <DashboardCard>
        <div className="panel-label">Training Ground</div>
        {view.units.map((unit) => (
          <UnitRow
            key={unit.id}
            unit={unit}
            locked={locked}
            lockReason={lockReason}
            busy={busy}
            busyKey={busyKey}
            error={errorFor(`recruit:${unit.id}`)}
            onRecruit={(count) => act(`recruit:${unit.id}`, () => api.barracksRecruit(unit.id, count), `Recruited ${count} ${unit.label}.`)}
          />
        ))}
      </DashboardCard>

      <DashboardCard>
        <div className="panel-label">Mercenary Market</div>
        <p className="barracks-copy">
          {view.offers.length === 3 ? "Three" : String(view.offers.length)} bands are in the city this season. {view.activeBands} of {view.config.maxActiveBands} under contract.
        </p>
        {view.offers.map((offer) => (
          <OfferRow
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
      </DashboardCard>

      <DashboardCard>
        <div className="panel-label">Roster</div>
        {roster.length === 0 ? (
          <p className="barracks-copy">No men under arms.</p>
        ) : (
          roster.map((row) => (
            <RosterRow
              key={row.id}
              row={row}
              offset={offset}
              releaseAt={releaseAtIso(row, view)}
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
          ))
        )}
      </DashboardCard>

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
