import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type KoinonArmies, type KoinonArmyRow, type KoinonMember, type KoinonMissionKind, type KoinonPage } from "../../api.js";
import { professions } from "../../data/league.js";
import { LobbyPortrait } from "../../lobby/LobbyPortrait.js";
import { AssetIcon, BuildProgress, DashboardCard, formatDuration, HouseCrest, type PanelProps, titleCase } from "../shared.js";

// --- The koinon (koinon prompt 1) — a Politics tab ---------------------------
// A player-made company of citizens. The page comes from GET /api/koinon and is
// read again after every action; every number shown comes from its `rules`
// block. The leader also reads GET /api/koinon/armies: the members' soldiers,
// read-only. Durations count from the payload's `now` and do not tick.

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
  // counts down on it, and the page is read once more when the Lesche stands.
  const offset = useMemo(() => (page ? Date.parse(page.now) - Date.now() : 0), [page]);
  const hallPhase = page?.koinon?.hall.phase ?? "none";
  const hallCompletesAt = page?.koinon?.hall.completesAt ?? null;
  useEffect(() => {
    if (hallPhase !== "building" || !hallCompletesAt) return;
    const wait = Date.parse(hallCompletesAt) - offset - Date.now() + 1000;
    const timer = setTimeout(() => void load().catch(() => {}), Math.max(1000, wait));
    return () => clearTimeout(timer);
  }, [hallPhase, hallCompletesAt, offset, load]);

  const run = async (work: () => Promise<unknown>, after?: () => void) => {
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
