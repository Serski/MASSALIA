import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type BarracksOffer, type BarracksRosterRow, type BarracksUnit, type BarracksView } from "../../api.js";
import { AssetIcon, DashboardCard, GoodGlyph, type PanelProps, PanelRow, QtyStepper } from "../shared.js";

// The Barracks tab (military prompt 2). Renders the GET /api/barracks view and
// sends recruit / hire / disband intents. The server is authoritative: every
// successful POST returns the next view, which replaces local state outright —
// no optimistic updates, no polling, no browser storage. Unit and band data
// reach this panel only through the API payload.

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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// "· in 2 seasons" for a future season index; nothing once it has arrived.
function inSeasons(target: number, season: number): string {
  const n = target - season;
  return n > 0 ? ` · in ${plural(n, "season")}` : "";
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
            Trains in {plural(unit.trainSeasons, "season")}
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
      Contract {plural(termSeasons, "season")}
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

function rosterStatus(row: BarracksRosterRow, season: number): string {
  if (row.source === "band") {
    const end = row.contractEndSeason ?? season;
    return `Contract ends season ${end}${inSeasons(end, season)}`;
  }
  if (row.active) return "Ready";
  const ready = row.readyAtSeason ?? season;
  return `Training, ready season ${ready}${inSeasons(ready, season)}`;
}

function RosterRow({
  row,
  season,
  locked,
  lockReason,
  busy,
  busyKey,
  confirming,
  error,
  onConfirmChange,
  onDisband,
}: {
  row: BarracksRosterRow;
  season: number;
  locked: boolean;
  lockReason: string;
  busy: boolean;
  busyKey: string | null;
  confirming: boolean;
  error: string | null;
  onConfirmChange: (open: boolean) => void;
  onDisband: () => void;
}) {
  const disabledReason = locked ? lockReason : row.canDisband ? null : SERVICE_REASON;
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
        sub={rosterStatus(row, season)}
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
              season={view.season}
              locked={locked}
              lockReason={lockReason}
              busy={busy}
              busyKey={busyKey}
              confirming={confirmId === row.id}
              error={errorFor(`disband:${row.id}`)}
              onConfirmChange={(open) => setConfirmId(open ? row.id : null)}
              onDisband={() => act(`disband:${row.id}`, () => api.barracksDisband(row.id), `Disbanded the ${row.label}.`)}
            />
          ))
        )}
      </DashboardCard>

      {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
    </section>
  );
}
