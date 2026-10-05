import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type KoinonArmies, type KoinonArmyRow, type KoinonLastMuster, type KoinonMember, type KoinonMissionKind, type KoinonMuster, type KoinonMusterMine, type KoinonMusterTargets, type KoinonPage } from "../../api.js";
import { professions } from "../../data/league.js";
import { LobbyPortrait } from "../../lobby/LobbyPortrait.js";
import { AssetIcon, BuildProgress, ChoicePicker, DashboardCard, formatDuration, HouseCrest, onDeviceClock, type PanelProps, titleCase, useCountdownSeconds } from "../shared.js";

// --- The koinon (koinon prompt 1) — a Politics tab ---------------------------
// A player-made company of citizens. The page comes from GET /api/koinon and is
// read again after every action; every number shown comes from its `rules`
// block. The leader also reads GET /api/koinon/armies: the members' soldiers,
// read-only. Durations count from the payload's `now` and do not tick.
//
// The Raid muster (koinon prompt 3) is a card of its own between the Board and
// the Treasury: the form that calls one, or the open muster with its pledges,
// the member's own pledge, and the last muster's report.

type Koinon = NonNullable<KoinonPage["koinon"]>;

const secondsBetween = (fromIso: string, toIso: string) => Math.max(0, Math.ceil((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
const hoursLeft = (now: string, expiresAt: string) => Math.max(1, Math.ceil(secondsBetween(now, expiresAt) / 3600));
const menText = (n: number) => `${n} ${n === 1 ? "man" : "men"}`;
const className = (slug: string | null) => (slug ? (professions.find((p) => p.slug === slug)?.name ?? titleCase(slug)) : "");

// The Barracks roster's own wording for a party on the march (BarracksPanel's
// missionLine), keyed by what the server derived.
const MISSION_VERB: Record<KoinonMissionKind, string> = { raid: "Raiding", scout: "Scouting", attack: "Marching on", move: "Marching to", return: "Returning from" };
export function awayLine(row: { missionKind: KoinonMissionKind; targetName: string | null }): string {
  if (!row.targetName) return row.missionKind === "return" ? "Returning" : MISSION_VERB[row.missionKind];
  return `${MISSION_VERB[row.missionKind]} ${row.targetName}`;
}

// A framed card in the council tab's look: the Greek-key band, a spaced label
// over a ruled line, then the body.
function KoinonCard({ title, note, section, children }: { title: string; note?: ReactNode; section: string; children: ReactNode }) {
  return (
    <DashboardCard className="chamber-card koinon-card">
      <div className="meander" aria-hidden="true" />
      <div className="koinon-body" data-koinon={section}>
        <div className="chamber-head">
          <span className="chamber-head-label">{title}</span>
          <span className="chamber-rule" aria-hidden="true" />
          {note ? <span className="koinon-head-note">{note}</span> : null}
        </div>
        {children}
      </div>
    </DashboardCard>
  );
}

function UnitLine({ row, sub }: { row: KoinonArmyRow; sub?: string }) {
  return (
    <div className="koinon-unit">
      <span className="koinon-unit-ic">{row.icon ? <AssetIcon file={row.icon} alt="" className="asset-icon koinon-glyph" /> : null}</span>
      <div className="koinon-unit-body">
        <div className="koinon-unit-name">
          {row.label} <span className="koinon-dim">· {row.count}</span>
        </div>
        {sub ? <div className="koinon-unit-sub">{sub}</div> : null}
      </div>
    </div>
  );
}

function MemberSoldiers({ member, now }: { member: KoinonArmies["members"][number]; now: string }) {
  const rows = [...member.home.flatMap((p) => p.rows), ...member.away, ...member.training];
  const men = rows.reduce((n, r) => n + r.count, 0);
  const ships = member.fleet.pentekonters > 0 || member.fleet.triremes > 0;
  return (
    <details className="koinon-army" data-member={member.playerId}>
      <summary>
        {member.name} · {menText(men)} · levy {member.levy}
      </summary>
      <div className="koinon-army-body">
        {rows.length === 0 ? <p className="koinon-empty">No soldiers.</p> : null}
        {member.home.length > 0 ? (
          <div className="koinon-army-group" data-group="home">
            <div className="koinon-army-head">At home</div>
            {member.home.map((place) => (
              <div key={place.placeId} className="koinon-army-place">
                <div className="koinon-army-place-name">{place.placeName}</div>
                {place.rows.map((row, i) => (
                  <UnitLine key={`${row.source}:${row.unitId}:${i}`} row={row} />
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {member.away.length > 0 ? (
          <div className="koinon-army-group" data-group="away">
            <div className="koinon-army-head">Away</div>
            {member.away.map((row, i) => (
              <UnitLine key={`${row.unitId}:${i}`} row={row} sub={`${awayLine(row)} · back in ${formatDuration(secondsBetween(now, row.arrivesAt))}`} />
            ))}
          </div>
        ) : null}
        {member.training.length > 0 ? (
          <div className="koinon-army-group" data-group="training">
            <div className="koinon-army-head">In training</div>
            {member.training.map((row, i) => (
              <UnitLine key={`${row.unitId}:${i}`} row={row} sub={row.readyAt ? `ready in ${formatDuration(secondsBetween(now, row.readyAt))}` : undefined} />
            ))}
          </div>
        ) : null}
        {ships ? (
          <p className="koinon-fleet">
            {member.fleet.pentekonters} pentekonters · {member.fleet.triremes} triremes
          </p>
        ) : null}
      </div>
    </details>
  );
}

// Every live koinon of the city: name, leader, members. Shown to everyone, a
// member's own koinon among the rest.
function KoinaOfTheCity({ koina }: { koina: KoinonPage["koina"] }) {
  return (
    <KoinonCard title="Koina of the city" section="koina">
      {koina.length === 0 ? <p className="koinon-empty">No koina yet.</p> : null}
      {koina.map((k) => (
        <div key={k.id} className="koinon-row">
          <div className="koinon-row-body">
            <div className="koinon-row-title">
              {k.name} <span className="koinon-dim">· led by {k.leaderName} · {k.members} of {k.cap}</span>
            </div>
          </div>
        </div>
      ))}
    </KoinonCard>
  );
}

function MemberRow({ member, children }: { member: KoinonMember; children?: ReactNode }) {
  const facts = [className(member.professionSlug), member.party !== "none" ? titleCase(member.party) : "", `Joined ${member.joinedLabel}`].filter(Boolean);
  return (
    <div className="koinon-row koinon-member" data-member={member.playerId}>
      <LobbyPortrait portrait={member.portrait} faceId={member.faceId} professionSlug={member.professionSlug} name={member.name} size={32} />
      <div className="koinon-row-body">
        <div className="koinon-row-title">
          {member.name} of House {member.houseName} <HouseCrest house={member.houseSlug} />
          {member.role === "leader" ? <span className="koinon-tag">Leader</span> : member.role === "vice" ? <span className="koinon-tag">Vice</span> : null}
        </div>
        <div className="koinon-row-sub">{facts.join(" · ")}</div>
      </div>
      {children ? <div className="koinon-actions">{children}</div> : null}
    </div>
  );
}

// --- The Raid muster ---------------------------------------------------------

type Run = (work: () => Promise<unknown>, after?: () => void) => Promise<void>;

// The leads the launch picker offers, in minutes, held to the rules' bounds
// (the bounds themselves are always offered).
const MUSTER_LEADS = [30, 60, 120, 180, 360, 720, 1080, 1440];
const leadLabel = (minutes: number) => (minutes < 60 ? `In ${minutes} minutes` : minutes === 60 ? "In 1 hour" : minutes % 60 === 0 ? `In ${minutes / 60} hours` : `In ${formatDuration(minutes * 60)}`);
const targetKey = (t: { regionId: string; townId: string | null }) => (t.townId ? `t:${t.townId}` : `r:${t.regionId}`);
const hullsText = (n: number) => `${n} ${n === 1 ? "hull" : "hulls"}`;
// Nearest first: land targets by steps, then sea targets by steps, then by name.
type MusterTarget = KoinonMusterTargets["targets"][number];
const nearestFirst = (a: MusterTarget, b: MusterTarget) => Number(a.route === "sea") - Number(b.route === "sea") || a.steps - b.steps || a.name.localeCompare(b.name);

// The last muster: its report line and each member's part, why it stood down,
// or that it was called off.
function LastMuster({ last }: { last: KoinonLastMuster }) {
  const report = last.report;
  return (
    <div className="koinon-muster-last" data-muster-last={last.status}>
      <div className="koinon-subhead">Last muster</div>
      <div className="koinon-line">
        Raid on {last.targetName} <span className="koinon-dim">· {last.launchLabel}</span>
      </div>
      {last.status === "cancelled" ? <p className="koinon-hint">Called off.</p> : null}
      {last.status === "stood_down" ? <p className="koinon-hint">Stood down: {last.reason ?? "it could not march."}</p> : null}
      {last.status === "resolved" && report ? (
        <>
          {report.line ? <p className="koinon-hint">{report.line}</p> : null}
          {report.parts.map((part) => {
            const sent = part.men > 0 && part.hulls > 0 ? `${menText(part.men)} and ${hullsText(part.hulls)}` : part.hulls > 0 ? hullsText(part.hulls) : menText(part.men);
            return (
              <div key={part.playerId} className="koinon-line" data-part={part.playerId}>
                {part.name} <span className="koinon-dim">· sent {sent} · lost {part.lost}{report.outcome === "won" ? ` · ${part.drachmae} drachmae and ${part.grain} grain` : ""}</span>
              </div>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

// No muster open: the form that calls one. The targets are read for the chosen
// gathering place; the launch is a lead on the server's clock, and a lead that
// would land in Winter is greyed out (the server refuses it either way).
function MusterForm({ rules, offset, busy, run }: { rules: KoinonPage["rules"]; offset: number; busy: boolean; run: Run }) {
  const [targets, setTargets] = useState<KoinonMusterTargets | null>(null);
  const [gatherId, setGatherId] = useState<string | undefined>(undefined);
  const [target, setTarget] = useState("");
  const [lead, setLead] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .koinonMusterTargets(gatherId)
      .then((read) => {
        if (cancelled) return;
        // The list is shown nearest first, and the form opens on the first of them.
        const next = { ...read, targets: [...read.targets].sort(nearestFirst) };
        setTargets(next);
        setTarget((held) => (next.targets.some((t) => targetKey(t) === held) ? held : next.targets[0] ? targetKey(next.targets[0]) : ""));
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "The muster's targets could not be read."));
    return () => {
      cancelled = true;
    };
  }, [gatherId]);

  const minLead = rules.musterMinLeadMinutes;
  const maxLead = rules.musterMaxLeadHours * 60;
  const leads = useMemo(() => [...new Set([minLead, ...MUSTER_LEADS.filter((m) => m > minLead && m < maxLead), maxLead])], [minLead, maxLead]);
  if (error) return <p className="koinon-reason">{error}</p>;
  if (!targets) return <p className="koinon-empty">Reading the roads…</p>;

  // A lead lands in Winter when the server's clock plus the lead falls inside the window the server named.
  const serverNow = Date.now() + offset;
  const inWinter = (minutes: number) => {
    if (!targets.winter) return false;
    const at = serverNow + minutes * 60_000;
    return at >= Date.parse(targets.winter.from) && at < Date.parse(targets.winter.until);
  };
  const chosenLead = lead !== null && leads.includes(lead) && !inWinter(lead) ? lead : (leads.find((m) => !inWinter(m)) ?? null);
  const chosenTarget = targets.targets.find((t) => targetKey(t) === target) ?? null;
  const open = () => {
    if (!chosenTarget || chosenLead === null) return;
    void run(() => api.koinonMusterOpen({ ...(chosenTarget.townId ? { townId: chosenTarget.townId } : { regionId: chosenTarget.regionId }), gatherId: targets.gatherId, leadMinutes: chosenLead }));
  };

  return (
    <div className="koinon-muster-form" data-muster="form">
      <div className="koinon-muster-field">
        <span className="koinon-muster-label">Gathering place</span>
        <ChoicePicker ariaLabel="gathering place" value={targets.gatherId} options={targets.gathers.map((g) => ({ id: g.id, label: g.name }))} onSelect={setGatherId} disabled={busy} />
      </div>
      <div className="koinon-muster-field">
        <span className="koinon-muster-label">Target</span>
        <ChoicePicker
          ariaLabel="target of the raid"
          value={target}
          options={targets.targets.map((t) => ({ id: targetKey(t), label: t.name, note: t.route === "land" ? "by land" : `${t.steps} ${t.steps === 1 ? "sea" : "seas"}` }))}
          onSelect={setTarget}
          disabled={busy || targets.targets.length === 0}
        />
      </div>
      <div className="koinon-muster-field">
        <span className="koinon-muster-label">Launch</span>
        <ChoicePicker
          ariaLabel="launch of the raid"
          value={chosenLead === null ? "" : String(chosenLead)}
          options={leads.map((m) => ({ id: String(m), label: leadLabel(m), ...(inWinter(m) ? { note: "Winter", disabled: true } : {}) }))}
          onSelect={(id) => setLead(Number(id))}
          disabled={busy || chosenLead === null}
        />
      </div>
      {targets.targets.length === 0 ? <p className="koinon-reason">Nothing can be reached from {targets.gathers.find((g) => g.id === targets.gatherId)?.name ?? "there"}.</p> : null}
      {chosenLead === null ? <p className="koinon-reason">The passes are closed in winter: no launch can be set yet.</p> : null}
      <div className="koinon-actions koinon-actions-start">
        <button type="button" className="panel-btn" data-action="muster-open" disabled={busy || !chosenTarget || chosenLead === null} onClick={open}>
          Call the muster
        </button>
      </div>
    </div>
  );
}

// The member's own pledge: his rows at the gathering place and his hulls, read
// from GET /muster/mine. That read settles him, so it runs on open and after
// an action (a new page payload), never on a timer.
function YourPledge({ muster, stamp, busy, run }: { muster: KoinonMuster; stamp: KoinonPage; busy: boolean; run: Run }) {
  const [mine, setMine] = useState<KoinonMusterMine | null>(null);
  const [error, setError] = useState("");
  const [men, setMen] = useState<Record<string, number>>({});
  const [hulls, setHulls] = useState<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    api
      .koinonMusterMine()
      .then((next) => {
        if (cancelled) return;
        setMine(next);
        setError("");
        setMen({});
        setHulls(Object.fromEntries(next.ships.map((s) => [s.id, s.pledged])));
      })
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Your men could not be read."));
    return () => {
      cancelled = true;
    };
  }, [stamp, muster.id]);

  if (error) return <p className="koinon-reason">{error}</p>;
  if (!mine) return <p className="koinon-empty">Reading your men…</p>;

  const free = mine.rows.filter((r) => !r.pledged);
  const pledged = mine.rows.filter((r) => r.pledged);
  const ships = mine.ships.filter((s) => s.inStock > 0 || s.pledged > 0);
  const hasPledge = pledged.length > 0 || mine.ships.some((s) => s.pledged > 0);
  const clamp = (value: string, max: number) => Math.max(0, Math.min(Math.floor(Number(value)) || 0, max));
  const rows = free.flatMap((r) => ((men[r.rowId] ?? 0) > 0 ? [{ rowId: r.rowId, count: men[r.rowId]! }] : []));
  const hullsChanged = ships.some((s) => (hulls[s.id] ?? 0) !== s.pledged);
  const pledge = () =>
    void run(() => api.koinonMusterPledge({ ...(rows.length > 0 ? { rows } : {}), ...(hullsChanged ? { ships: Object.fromEntries(ships.map((s) => [s.id, hulls[s.id] ?? 0])) } : {}) }));

  return (
    <div className="koinon-muster-mine" data-muster="mine">
      <div className="koinon-subhead">Your pledge</div>
      {mine.rows.length === 0 ? <p className="koinon-hint">Move men to {mine.gather.name} from the Barracks or the map, then pledge them.</p> : null}
      {pledged.map((r) => (
        <div key={r.rowId} className="koinon-line" data-pledged={r.rowId}>
          {r.count} {r.count === 1 ? r.label : r.plural} <span className="koinon-tag">Pledged</span>
        </div>
      ))}
      {free.map((r) => (
        <label key={r.rowId} className="koinon-muster-pick" data-row={r.rowId}>
          <span className="koinon-muster-pick-name">
            {r.count === 1 ? r.label : r.plural} <span className="koinon-dim">· {r.count} at {mine.gather.name}{r.source === "band" ? " · a band marches as one" : ""}</span>
          </span>
          <input
            className="koinon-input koinon-amount"
            type="number"
            inputMode="numeric"
            aria-label={`${r.plural} to pledge`}
            min={0}
            max={r.count}
            step={r.source === "band" ? r.count : 1}
            value={men[r.rowId] ?? 0}
            disabled={busy}
            onChange={(event) => {
              const n = clamp(event.target.value, r.count);
              setMen((held) => ({ ...held, [r.rowId]: r.source === "band" && n > 0 ? r.count : n }));
            }}
          />
        </label>
      ))}
      {ships.map((s) => (
        <label key={s.id} className="koinon-muster-pick" data-ship={s.id}>
          <span className="koinon-muster-pick-name">
            {s.label} <span className="koinon-dim">· {s.inStock} in port · carries {s.troopSpace} · sails {s.range} {s.range === 1 ? "sea" : "seas"}</span>
          </span>
          <input
            className="koinon-input koinon-amount"
            type="number"
            inputMode="numeric"
            aria-label={`${s.label} hulls to pledge`}
            min={0}
            max={s.inStock}
            step={1}
            value={hulls[s.id] ?? 0}
            disabled={busy}
            onChange={(event) => {
              const n = clamp(event.target.value, s.inStock);
              setHulls((held) => ({ ...held, [s.id]: n }));
            }}
          />
        </label>
      ))}
      <div className="koinon-actions koinon-actions-start">
        <button type="button" className="panel-btn" data-action="muster-pledge" disabled={busy || (rows.length === 0 && !hullsChanged)} onClick={pledge}>
          Pledge
        </button>
        {hasPledge ? (
          <button type="button" className="panel-btn ghost" data-action="muster-withdraw" disabled={busy} onClick={() => void run(() => api.koinonMusterWithdraw())}>
            Withdraw my pledge
          </button>
        ) : null}
      </div>
    </div>
  );
}

// An open muster: where and when, what has been pledged and whether it would
// march as it stands, the member's own pledge, and the call-off.
function MusterOpen({ muster, stamp, offset, busy, run }: { muster: KoinonMuster; stamp: KoinonPage; offset: number; busy: boolean; run: Run }) {
  // The countdown runs on the payload's server clock, never the device's alone.
  const left = useCountdownSeconds(onDeviceClock(muster.launchAt, offset));
  const outlook = muster.outlook;
  return (
    <div className="koinon-muster-open" data-muster="open">
      <p className="koinon-muster-head">
        Raid on {muster.target.name} · gathering at {muster.gather.name} · {left > 0 ? `marches in ${formatDuration(left)}` : "marching"}
      </p>
      <p className="koinon-hint">Called by {muster.openerName}</p>
      {outlook.route === "land" ? <p className="koinon-hint" data-outlook="land">As pledged: by land.</p> : null}
      {outlook.route === "sea" ? (
        <p className="koinon-hint" data-outlook="sea">
          As pledged: by sea, {outlook.steps} {outlook.steps === 1 ? "sea" : "seas"}, {Math.min(outlook.space, outlook.hullSpace)} of {outlook.hullSpace} seats filled.
        </p>
      ) : null}
      {!outlook.ok && outlook.reason ? <p className="koinon-reason" data-outlook="reason">{outlook.reason}</p> : null}

      <div className="koinon-subhead">Pledges</div>
      {muster.pledges.length === 0 ? <p className="koinon-empty">No one has pledged yet.</p> : null}
      {muster.pledges.map((p) => (
        <div key={p.playerId} className="koinon-line" data-pledge={p.playerId}>
          {p.name} <span className="koinon-dim">· {menText(p.men)} · {p.pentekonters} {p.pentekonters === 1 ? "pentekonter" : "pentekonters"} · {p.triremes} {p.triremes === 1 ? "trireme" : "triremes"}</span>
        </div>
      ))}

      <YourPledge muster={muster} stamp={stamp} busy={busy} run={run} />

      {muster.canCancel ? (
        <div className="koinon-actions koinon-actions-start">
          <button
            type="button"
            className="panel-btn danger"
            data-action="muster-cancel"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Call off the raid on ${muster.target.name}? Every pledge falls with it.`)) void run(() => api.koinonMusterCancel());
            }}
          >
            Call it off
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function KoinonView({ onRefresh }: PanelProps) {
  const [page, setPage] = useState<KoinonPage | null>(null);
  const [armies, setArmies] = useState<KoinonArmies | null>(null);
  const [loadError, setLoadError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [foundName, setFoundName] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [postBody, setPostBody] = useState("");
  const [giveAmount, setGiveAmount] = useState(1);
  const reading = useRef(false);

  // The page, and for the leader the soldiers; read on mount and after every action.
  const load = useCallback(async () => {
    const next = await api.koinon();
    setPage(next);
    setArmies(next.me.role === "leader" ? await api.koinonArmies() : null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch((error) => !cancelled && setLoadError(error instanceof ApiError ? error.message : "The koinon could not be read."));
    return () => {
      cancelled = true;
    };
  }, [load]);

  // Unread posts on the board: stamp them read once, then let the nav count drop.
  const unread = page?.koinon?.unread ?? 0;
  useEffect(() => {
    if (unread <= 0 || reading.current) return;
    reading.current = true;
    api
      .koinonRead()
      .then(() => onRefresh())
      .catch(() => {})
      .finally(() => {
        reading.current = false;
      });
  }, [unread, onRefresh]);

  // Server clock minus device clock, taken once per payload: the build bar
  // counts down on it.
  const offset = useMemo(() => (page ? Date.parse(page.now) - Date.now() : 0), [page]);
  // One read when the Lesche stands. It belongs to the payload that armed it:
  // the instant is the payload's completesAt moved onto the device clock by
  // that payload's own offset (never the device clock alone), and every new
  // payload, and the unmount, clear it. A payload that still says building
  // arms the next read from its own `now`; any other phase arms nothing.
  useEffect(() => {
    const hall = page?.koinon?.hall;
    if (!hall || hall.phase !== "building") return;
    const standsAt = onDeviceClock(hall.completesAt, offset);
    if (!standsAt) return;
    const timer = setTimeout(() => void load().catch(() => {}), Math.max(1000, Date.parse(standsAt) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [page, offset, load]);

  // One read a second after an open muster's launch, armed and cleared exactly
  // as the Lesche's is: from the payload's own clock, keyed on the payload. A
  // payload already past the launch that still shows the muster open (its
  // resolve is in hand elsewhere, or failed) looks again in a minute.
  useEffect(() => {
    const muster = page?.koinon?.muster;
    if (!page || !muster) return;
    const marchesAt = onDeviceClock(muster.launchAt, offset);
    if (!marchesAt) return;
    const past = Date.parse(muster.launchAt) <= Date.parse(page.now);
    const timer = setTimeout(() => void load().catch(() => {}), past ? 60_000 : Math.max(1000, Date.parse(marchesAt) - Date.now() + 1000));
    return () => clearTimeout(timer);
  }, [page, offset, load]);

  const run: Run = async (work, after) => {
    setBusy(true);
    setNote("");
    try {
      await work();
      after?.();
      await load();
      onRefresh();
    } catch (error) {
      setNote(error instanceof ApiError ? error.message : "The koinon could not be reached. Try again.");
      // A refusal often means the page is stale (an invite gone, a seat taken).
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <p className="dashboard-todo" role="status">{loadError}</p>;
  if (!page) return <p className="dashboard-todo">Reading the koinon…</p>;

  const { rules, me, now } = page;
  const cooldownSeconds = me.cooldownUntil ? secondsBetween(now, me.cooldownUntil) : 0;
  const status = note ? <p className="dashboard-todo koinon-note" role="status">{note}</p> : null;

  // --- Not in a koinon -------------------------------------------------------
  if (!page.koinon) {
    const foundReason =
      cooldownSeconds > 0
        ? `You left a koinon too recently. You may found another in ${formatDuration(cooldownSeconds)}.`
        : me.prestige < rules.foundPrestige
          ? `Your prestige is ${me.prestige}. Founding needs ${rules.foundPrestige}.`
          : me.drachmae < rules.foundCost
            ? `You hold ${me.drachmae} drachmae. Founding costs ${rules.foundCost}.`
            : null;
    return (
      <div className="pol-page koinon-page">
        <p className="koinon-lede">A koinon is a sworn company of citizens. Its leader sees the soldiers of every member.</p>
        {status}

        {page.invites.length > 0 ? (
          <KoinonCard title="Your invitations" section="invitations">
            <p className="koinon-hint">Accepting lets its leader see your soldiers.</p>
            {cooldownSeconds > 0 ? <p className="koinon-reason">You left a koinon too recently. You may join another in {formatDuration(cooldownSeconds)}.</p> : null}
            {page.invites.map((invite) => (
              <div key={invite.id} className="koinon-row" data-invite={invite.id}>
                <div className="koinon-row-body">
                  <div className="koinon-row-title">
                    {invite.koinonName} <span className="koinon-dim">· invited by {invite.inviterName} · {hoursLeft(now, invite.expiresAt)}h left</span>
                  </div>
                </div>
                <div className="koinon-actions">
                  <button type="button" className="panel-btn" disabled={busy || cooldownSeconds > 0} onClick={() => void run(() => api.koinonAccept(invite.id))}>
                    Accept
                  </button>
                  <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => void run(() => api.koinonDecline(invite.id))}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </KoinonCard>
        ) : null}

        <KoinonCard title="Found a koinon" section="found">
          <p className="koinon-hint">
            Needs prestige {rules.foundPrestige} and {rules.foundCost} drachmae.
          </p>
          <form
            className="koinon-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.koinonFound(foundName), () => setFoundName(""));
            }}
          >
            <input className="koinon-input" aria-label="The koinon's name" value={foundName} maxLength={rules.nameMax} onChange={(event) => setFoundName(event.target.value)} />
            <button type="submit" className="panel-btn" data-action="found" disabled={busy || foundReason !== null} title={foundReason ?? undefined}>
              Found · {rules.foundCost} drachmae
            </button>
          </form>
          {foundReason ? <p className="koinon-reason">{foundReason}</p> : null}
        </KoinonCard>

        <KoinaOfTheCity koina={page.koina} />
      </div>
    );
  }

  // --- In a koinon -------------------------------------------------------------
  const koinon: Koinon = page.koinon;
  const leads = me.role === "leader";
  const posts = me.role === "leader" || me.role === "vice";
  const leader = koinon.members.find((m) => m.playerId === koinon.leaderPlayerId);
  const vice = koinon.members.find((m) => m.playerId === koinon.vicePlayerId);
  // The page lists the leader, then the vice, then the rest by standing: the
  // second row is who the lead passes to when the leader leaves.
  const successor = koinon.members.find((m) => m.playerId !== me.playerId);
  const confirmThen = (text: string, work: () => Promise<unknown>) => {
    if (window.confirm(text)) void run(work);
  };
  const leaveText =
    `Leave ${koinon.name}? You cannot join or found another koinon for ${rules.cooldownHours} hours.` +
    (leads ? (successor ? ` The lead passes to ${successor.name}.` : ` No one is left to take it: the koinon ends, and its treasury of ${koinon.treasury} drachmae goes to the city.`) : "");
  // A gift is a whole number from 1 to the smaller of the rule's cap and the purse.
  const giveMax = Math.min(rules.depositMax, me.drachmae);
  const giving = Math.max(1, Math.min(giveAmount, giveMax));
  const hall = koinon.hall;

  return (
    <div className="pol-page koinon-page">
      {status}

      <KoinonCard title={koinon.name} section="header" note={`${koinon.members.length} of ${koinon.cap}`}>
        <p className="koinon-facts">
          Founded {koinon.foundedLabel}
          {leader ? <> · Leader {leader.name}</> : null}
          {vice ? <> · Vice {vice.name}</> : null}
        </p>
      </KoinonCard>

      {koinon.canTakeLead ? (
        <KoinonCard title="The lead" section="take-lead">
          <p className="koinon-hint">{leader?.name ?? "The leader"} has not been seen for {rules.absentLeaderDays} days. You may take the lead.</p>
          <div className="koinon-actions">
            <button type="button" className="panel-btn" data-action="take-lead" disabled={busy} onClick={() => void run(() => api.koinonTakeLead())}>
              Take the lead
            </button>
          </div>
        </KoinonCard>
      ) : null}

      <KoinonCard title="Board" section="board">
        {posts ? (
          <form
            className="koinon-post-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.koinonPost(postBody), () => setPostBody(""));
            }}
          >
            <textarea className="koinon-input koinon-textarea" aria-label="A message for the board" rows={3} value={postBody} maxLength={rules.postMaxChars} onChange={(event) => setPostBody(event.target.value)} />
            <div className="koinon-post-bar">
              <span className="koinon-counter">
                {postBody.length} / {rules.postMaxChars}
              </span>
              <button type="submit" className="panel-btn" data-action="post" disabled={busy || postBody.trim().length === 0}>
                Post
              </button>
            </div>
          </form>
        ) : null}
        {koinon.posts.length === 0 ? <p className="koinon-empty">No word from the leaders yet.</p> : null}
        {koinon.posts.map((p) => (
          <div key={p.id} className="koinon-row koinon-post" data-post={p.id}>
            <div className="koinon-row-body">
              <div className="koinon-row-sub">
                {p.authorName} · {p.label}
              </div>
              <div className="koinon-post-body">{p.body}</div>
            </div>
            {p.canDelete ? (
              <div className="koinon-actions">
                <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => void run(() => api.koinonPostDelete(p.id))}>
                  Delete
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </KoinonCard>

      <KoinonCard title="Muster" section="muster">
        {koinon.muster ? (
          <MusterOpen muster={koinon.muster} stamp={page} offset={offset} busy={busy} run={run} />
        ) : (
          <>
            <p className="koinon-hint">Any member may call the koinon to a raid. Members bring men to the gathering place and pledge them. At the hour they march as one.</p>
            <MusterForm rules={rules} offset={offset} busy={busy} run={run} />
            {koinon.lastMuster ? <LastMuster last={koinon.lastMuster} /> : null}
          </>
        )}
      </KoinonCard>

      <KoinonCard title="Treasury" section="treasury" note={`${koinon.treasury} drachmae`}>
        <p className="koinon-hint">Members give drachmae to the koinon. Nothing comes back out: the treasury pays only for the koinon's buildings.</p>
        <form
          className="koinon-form koinon-give"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.koinonGive(giving), () => setGiveAmount(1));
          }}
        >
          <input
            className="koinon-input koinon-amount"
            type="number"
            inputMode="numeric"
            aria-label="Drachmae to give"
            min={1}
            max={Math.max(1, giveMax)}
            step={1}
            value={giving}
            disabled={giveMax < 1}
            onChange={(event) => setGiveAmount(Math.max(1, Math.min(Math.floor(Number(event.target.value)) || 1, Math.max(1, giveMax))))}
          />
          <button type="submit" className="panel-btn" data-action="give" disabled={busy || giveMax < 1}>
            Give
          </button>
        </form>
        {koinon.givers.length === 0 ? (
          <p className="koinon-empty">No gifts yet.</p>
        ) : (
          <>
            <div className="koinon-subhead">Givers</div>
            {koinon.givers.map((giver) => (
              <div key={giver.playerId} className="koinon-line" data-giver={giver.playerId}>
                {giver.name} <span className="koinon-dim">· {giver.total}</span>
              </div>
            ))}
            <div className="koinon-subhead">Recent gifts</div>
            {koinon.gifts.map((gift) => (
              <div key={gift.id} className="koinon-line" data-gift={gift.id}>
                {gift.name} gave {gift.amount} <span className="koinon-dim">· {gift.label}</span>
              </div>
            ))}
          </>
        )}
      </KoinonCard>

      <KoinonCard title="Lesche" section="lesche">
        {hall.phase === "none" ? (
          <>
            <p className="koinon-hint">
              A hall for the koinon. While it stands open the koinon holds up to {rules.lescheCap} members. It costs {rules.lescheCost} drachmae from the treasury, takes {rules.lescheBuildDays} days to build, and {rules.lescheUpkeep} drachmae a day to keep.
            </p>
            {leads ? (
              <>
                <div className="koinon-actions koinon-actions-start">
                  <button
                    type="button"
                    className="panel-btn"
                    data-action="lesche"
                    disabled={busy || koinon.treasury < rules.lescheCost}
                    onClick={() => confirmThen(`Build the Lesche for ${rules.lescheCost} drachmae from the treasury? It cannot be cancelled.`, () => api.koinonBuildLesche())}
                  >
                    Build the Lesche · {rules.lescheCost}
                  </button>
                </div>
                {koinon.treasury < rules.lescheCost ? <p className="koinon-reason">The treasury holds {koinon.treasury} drachmae.</p> : null}
              </>
            ) : null}
          </>
        ) : hall.phase === "building" ? (
          <BuildProgress label="Building the Lesche" startedAt={hall.startedAt} completesAt={hall.completesAt} offset={offset} />
        ) : hall.phase === "open" ? (
          <p className="koinon-hint">
            Open. Up to {rules.lescheCap} members. Upkeep {rules.lescheUpkeep} drachmae a day; the treasury covers {hall.daysCovered} more days.
          </p>
        ) : (
          <p className="koinon-hint">
            Shut: the treasury could not pay its upkeep. No one new joins past {rules.memberCap} until it reopens. It reopens when the treasury holds {rules.lescheUpkeep} drachmae.
          </p>
        )}
      </KoinonCard>

      <KoinonCard title="Members" section="members" note={`${koinon.members.length} of ${koinon.cap}`}>
        {koinon.members.map((member) => (
          <MemberRow key={member.playerId} member={member}>
            {leads && member.playerId !== me.playerId ? (
              <>
                {member.role === "vice" ? (
                  <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => confirmThen(`Clear ${member.name} as vice?`, () => api.koinonVice(null))}>
                    Clear vice
                  </button>
                ) : (
                  <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => confirmThen(`Make ${member.name} the vice?`, () => api.koinonVice(member.playerId))}>
                    Make vice
                  </button>
                )}
                <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => confirmThen(`Hand over the lead to ${member.name}? You stay as a member.`, () => api.koinonHandOver(member.playerId))}>
                  Hand over the lead
                </button>
                <button
                  type="button"
                  className="panel-btn danger"
                  disabled={busy}
                  onClick={() => confirmThen(`Expel ${member.name}? They cannot join or found another koinon for ${rules.cooldownHours} hours.`, () => api.koinonExpel(member.playerId))}
                >
                  Expel
                </button>
              </>
            ) : null}
          </MemberRow>
        ))}
      </KoinonCard>

      {posts ? (
        <KoinonCard title="Invite" section="invite">
          <form
            className="koinon-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(() => api.koinonInvite(inviteName), () => setInviteName(""));
            }}
          >
            <input className="koinon-input" aria-label="The citizen's name" value={inviteName} onChange={(event) => setInviteName(event.target.value)} />
            <button type="submit" className="panel-btn" data-action="invite" disabled={busy || inviteName.trim().length === 0}>
              Invite
            </button>
          </form>
          {koinon.pending.map((invite) => (
            <div key={invite.id} className="koinon-row" data-pending={invite.id}>
              <div className="koinon-row-body">
                <div className="koinon-row-title">
                  {invite.playerName} <span className="koinon-dim">· {hoursLeft(now, invite.expiresAt)}h left</span>
                </div>
              </div>
              <div className="koinon-actions">
                <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => void run(() => api.koinonWithdraw(invite.id))}>
                  Withdraw
                </button>
              </div>
            </div>
          ))}
        </KoinonCard>
      ) : null}

      {leads && armies ? (
        <KoinonCard title="Soldiers of the koinon" section="soldiers">
          {armies.members.map((member) => (
            <MemberSoldiers key={member.playerId} member={member} now={armies.now} />
          ))}
        </KoinonCard>
      ) : null}

      <KoinaOfTheCity koina={page.koina} />

      <div className="koinon-leave">
        <button type="button" className="panel-btn danger" data-action="leave" disabled={busy} onClick={() => confirmThen(leaveText, () => api.koinonLeave())}>
          Leave
        </button>
      </div>
    </div>
  );
}
