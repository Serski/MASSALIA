import { useEffect, useRef, useState } from "react";
import { api, ApiError, type LobbyResponse } from "../api.js";
import { maskEmail } from "../dashboard/sheets.js";
import { OFFICE_LABEL, bcYear } from "../dashboard/panels/PoliticsPanel.js";
import { navigateTo } from "../navigate.js";
import { NO_SEAT_PORTRAIT } from "./art.js";
import { LobbyFrame, LobbySectionHeading as SectionHeading } from "./LobbyFrame.js";
import { LobbyPortrait } from "./LobbyPortrait.js";
import type { LobbyView } from "./routes.js";
import "./lobby.css";

// ---------------------------------------------------------------------------
// The account-level Lobby (/lobby): the worlds (the open one and your seat in
// it, the calendar of announced worlds, the ended ones), your record, the Hall
// of Fame (an empty state until results exist) and your account. News and the
// guides are their own public pages (/news, /guides) reached from the frame's
// nav. Everything here is a read of GET /api/lobby; the only writes are the
// newsletter opt-in, log out and account deletion, through the same api calls
// the Settings tab uses. Styled with lobby- classes over the landing tokens.
// ---------------------------------------------------------------------------

type LobbyPageProps = {
  // /lobby → "worlds", /lobby/account → "account", /lobby/hall-of-fame → "hall-of-fame".
  view: LobbyView;
  onEnterGame: () => void;
  onCreateCharacter: () => void;
  onRequireLogin: () => void;
  onLoggedOut: () => void;
};

type ActiveWorld = NonNullable<LobbyResponse["worlds"]["active"]>;
type LobbyUser = LobbyResponse["user"];

function ordinal(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function monthYear(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function LobbyPage({ view, onEnterGame, onCreateCharacter, onRequireLogin, onLoggedOut }: LobbyPageProps) {
  const [lobby, setLobby] = useState<LobbyResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [newsletter, setNewsletter] = useState(false);
  const [savingNewsletter, setSavingNewsletter] = useState(false);
  const [newsletterNote, setNewsletterNote] = useState("");
  // The parent's callbacks are inline arrows; keep the latest without re-fetching.
  const requireLoginRef = useRef(onRequireLogin);
  requireLoginRef.current = onRequireLogin;

  useEffect(() => {
    let active = true;
    setStatus("loading");
    api
      .lobby()
      .then((lobbyData) => {
        if (!active) return;
        setLobby(lobbyData);
        setNewsletter(lobbyData.user.newsletterOptIn);
        setStatus("ready");
      })
      .catch((error) => {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          requireLoginRef.current();
          return;
        }
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      onLoggedOut();
    }
  };

  // Optimistic, reverted on failure — the same discipline as the Settings tab.
  const toggleNewsletter = async () => {
    const next = !newsletter;
    setNewsletter(next);
    setSavingNewsletter(true);
    setNewsletterNote("");
    try {
      await api.setNewsletter(next);
    } catch {
      setNewsletter(!next);
      setNewsletterNote("Could not save your newsletter preference. Try again.");
    } finally {
      setSavingNewsletter(false);
    }
  };

  return (
    <LobbyFrame active="lobby">
      {status === "loading" ? (
        <p className="lobby-quiet" role="status" aria-busy="true">Opening the lobby…</p>
      ) : status === "error" || !lobby ? (
        <div className="lobby-quiet" role="alert">
          <p>Could not reach the lobby.</p>
          <button className="lobby-btn" type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : view === "account" ? (
        <div className="lobby-page">
          <BackToWorlds />
          <AccountSection
            user={lobby.user}
            newsletter={newsletter}
            savingNewsletter={savingNewsletter}
            newsletterNote={newsletterNote}
            onToggleNewsletter={toggleNewsletter}
            onLogout={logout}
            onAccountDeleted={onLoggedOut}
          />
        </div>
      ) : view === "hall-of-fame" ? (
        <div className="lobby-page">
          <BackToWorlds />
          <HallOfFameSection ended={lobby.worlds.ended} />
        </div>
      ) : (
        <div className="lobby-shell-grid">
          <LeftColumn view={view} user={lobby.user} record={lobby.record} you={lobby.worlds.active?.you ?? null} />
          <div className="lobby-main">
            <WorldsSection
              worlds={lobby.worlds}
              newsletter={newsletter}
              savingNewsletter={savingNewsletter}
              onToggleNewsletter={toggleNewsletter}
              onEnterGame={onEnterGame}
              onCreateCharacter={onCreateCharacter}
            />
          </div>
          <aside className="lobby-aside-right" />
        </div>
      )}
    </LobbyFrame>
  );
}

// --- Left column: character card, nav, your record ------------------------------

const LEFT_NAV: Array<{ view: LobbyView; label: string; path: string }> = [
  { view: "worlds", label: "Game worlds", path: "/lobby" },
  { view: "account", label: "Account", path: "/lobby/account" },
  { view: "hall-of-fame", label: "Hall of fame", path: "/lobby/hall-of-fame" },
];

function LeftColumn({ view, user, record, you }: { view: LobbyView; user: LobbyUser; record: LobbyResponse["record"]; you: ActiveWorld["you"] }) {
  return (
    <aside className="lobby-aside-left">
      <CharacterCard user={user} you={you} />
      <nav className="lobby-nav" aria-label="Lobby sections">
        {LEFT_NAV.map((item) => (
          <a
            key={item.view}
            className={`lobby-nav-item${item.view === view ? " lobby-nav-item-active" : ""}`}
            href={item.path}
            aria-current={item.view === view ? "page" : undefined}
            onClick={(event) => {
              event.preventDefault();
              navigateTo(item.path);
            }}
          >
            <span className="lobby-nav-dot" aria-hidden="true" />
            {item.label}
          </a>
        ))}
      </nav>
      <RecordPanel record={record} you={you} />
    </aside>
  );
}

// The viewer's seat in the open world; without one, the lion and the line that says so.
function CharacterCard({ user, you }: { user: LobbyUser; you: ActiveWorld["you"] }) {
  return (
    <section className="lobby-panel lobby-character" aria-label="Your character">
      {you ? (
        <LobbyPortrait className="lobby-character-portrait" portrait={you.portrait} faceId={you.faceId} professionSlug={you.professionSlug} name={you.name} size={132} />
      ) : (
        <img className="lobby-portrait lobby-character-portrait" src={NO_SEAT_PORTRAIT} alt="" width={132} height={132} />
      )}
      <h2 className="lobby-character-name">{you ? you.name : "No seat in this world"}</h2>
      {you && you.dynastyName ? (
        <p className="lobby-character-dynasty">
          {you.dynastyName}
          {you.generation !== null ? ` · ${ordinal(you.generation)} generation` : ""}
        </p>
      ) : null}
      <p className="lobby-character-meta">{[you?.professionName ?? null, `Member since ${monthYear(user.memberSince)}`].filter(Boolean).join(" · ")}</p>
    </section>
  );
}

function RecordPanel({ record, you }: { record: LobbyResponse["record"]; you: ActiveWorld["you"] }) {
  const latest = record.offices[0];
  const officesLabel = record.offices.length > 1 ? `Offices held (${record.offices.length})` : "Offices held";
  return (
    <section className="lobby-panel lobby-record" aria-labelledby="lobby-record-title">
      <p className="lobby-eyebrow" id="lobby-record-title">Your record</p>
      <dl className="lobby-record-rows">
        <div>
          <dt>Worlds played</dt>
          <dd>{record.worldsPlayed}</dd>
        </div>
        <div>
          <dt>Prestige rank</dt>
          <dd>{you && you.prestigeRank !== null ? `${you.prestigeRank} of ${you.rosterSize}` : "No seat yet"}</dd>
        </div>
        <div>
          <dt>{officesLabel}</dt>
          <dd>{latest ? `${OFFICE_LABEL[latest.office] ?? latest.office} · ${bcYear(latest.startedYear)}` : "None yet"}</dd>
        </div>
      </dl>
    </section>
  );
}

// The sub-views' way back to the front.
function BackToWorlds() {
  return (
    <p className="lobby-back">
      <a
        className="lobby-link"
        href="/lobby"
        onClick={(event) => {
          event.preventDefault();
          navigateTo("/lobby");
        }}
      >
        ← Game worlds
      </a>
    </p>
  );
}

function LobbyToggle({ on, disabled, label, onToggle }: { on: boolean; disabled: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`lobby-toggle${on ? " on" : ""}`}
      onClick={onToggle}
      disabled={disabled}
    >
      <span className="lobby-toggle-knob" aria-hidden="true" />
    </button>
  );
}

// --- Worlds ------------------------------------------------------------------

function hallOfFameClick(event: { preventDefault: () => void }) {
  event.preventDefault();
  navigateTo("/lobby/hall-of-fame");
}

function WorldsSection({
  worlds,
  newsletter,
  savingNewsletter,
  onToggleNewsletter,
  onEnterGame,
  onCreateCharacter,
}: {
  worlds: LobbyResponse["worlds"];
  newsletter: boolean;
  savingNewsletter: boolean;
  onToggleNewsletter: () => void;
  onEnterGame: () => void;
  onCreateCharacter: () => void;
}) {
  const { active, announced, ended } = worlds;
  return (
    <section className="lobby-section" aria-labelledby="lobby-worlds-title">
      <SectionHeading id="lobby-worlds-title" eyebrow="Worlds" title="The League" />

      {active ? (
        <ActiveWorldCard world={active} onEnterGame={onEnterGame} onCreateCharacter={onCreateCharacter} />
      ) : (
        <p className="lobby-empty">No world is open.</p>
      )}

      <h3 className="lobby-subhead">Calendar</h3>
      {announced.length ? (
        <ul className="lobby-list">
          {announced.map((world) => (
            <li className="lobby-row" key={world.id}>
              <div className="lobby-row-main">
                <strong>{world.name}</strong>
                {world.tagline ? <span className="lobby-tagline">{world.tagline}</span> : null}
                <span className="lobby-row-meta">opens on {longDate(world.startsAt)}</span>
              </div>
              {newsletter ? (
                <span className="lobby-notified">You&apos;ll be emailed when it opens.</span>
              ) : (
                <button className="lobby-btn lobby-btn-small" type="button" disabled={savingNewsletter} onClick={onToggleNewsletter}>
                  Notify me when it opens
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="lobby-empty">No world announced yet.</p>
      )}

      {ended.length ? (
        <>
          <h3 className="lobby-subhead">Ended</h3>
          <ul className="lobby-list">
            {ended.map((world) => (
              <li className="lobby-row" key={world.id}>
                <div className="lobby-row-main">
                  <a className="lobby-row-link" href="/lobby/hall-of-fame" onClick={hallOfFameClick}>{world.name}</a>
                  <span className="lobby-row-meta">
                    closed on {longDate(world.endsAt)}, {count(world.playerCount, "player", "players")}
                  </span>
                </div>
                <a className="lobby-link" href="/lobby/hall-of-fame" onClick={hallOfFameClick}>Hall of Fame →</a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function ActiveWorldCard({ world, onEnterGame, onCreateCharacter }: { world: ActiveWorld; onEnterGame: () => void; onCreateCharacter: () => void }) {
  const you = world.you;
  return (
    <article className="lobby-card lobby-world">
      <p className="lobby-kicker">
        <span className="lobby-pulse" aria-hidden="true" />
        Open now
      </p>
      <h3 className="lobby-world-name">{world.name}</h3>
      {world.tagline ? <p className="lobby-tagline">{world.tagline}</p> : null}
      <dl className="lobby-facts">
        <div>
          <dt>In-game date</dt>
          <dd>{world.gameDateLabel}</dd>
        </div>
        <div>
          <dt>Season</dt>
          <dd>ends in {count(world.seasonEndsIn, "day", "days")}</dd>
        </div>
        <div>
          <dt>Citizens</dt>
          <dd>{count(world.playerCount, "player", "players")}</dd>
        </div>
      </dl>
      {you ? (
        <div className="lobby-you">
          <p className="lobby-you-name">
            {you.name}
            {you.dynastyName ? <span className="lobby-you-dynasty"> · {you.dynastyName}</span> : null}
          </p>
          <p className="lobby-you-line">
            {[you.generation !== null ? `${ordinal(you.generation)} generation` : null, you.houseName, you.professionName].filter(Boolean).join(" · ")}
          </p>
          <p className="lobby-you-rank">
            {you.prestigeRank !== null ? `Ranked ${you.prestigeRank} of ${you.rosterSize} by prestige` : `${count(you.rosterSize, "citizen", "citizens")} ranked by prestige`}
          </p>
          <button className="lobby-btn lobby-btn-primary" type="button" onClick={onEnterGame}>Continue playing</button>
        </div>
      ) : (
        <div className="lobby-you">
          <p className="lobby-you-line">You hold no seat in this world yet.</p>
          <button className="lobby-btn lobby-btn-primary" type="button" onClick={onCreateCharacter}>Found your dynasty</button>
        </div>
      )}
    </article>
  );
}

// --- Hall of Fame ---------------------------------------------------------------

function HallOfFameSection({ ended }: { ended: LobbyResponse["worlds"]["ended"] }) {
  return (
    <section className="lobby-section" aria-labelledby="lobby-hall-title">
      <SectionHeading id="lobby-hall-title" eyebrow="Hall of Fame" title="Worlds that were" />
      {ended.length ? (
        <div className="lobby-hall">
          {ended.map((world) => (
            <article className="lobby-card lobby-hall-card" key={world.id}>
              <h3>{world.name}</h3>
              {world.tagline ? <p className="lobby-tagline">{world.tagline}</p> : null}
              <p className="lobby-row-meta">
                {longDate(world.startedAt)} to {longDate(world.endsAt)} · {count(world.playerCount, "player", "players")}
              </p>
              <p className="lobby-empty">Results will appear here when the world closes.</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="lobby-empty">No world has ended yet.</p>
      )}
    </section>
  );
}

// --- Account ------------------------------------------------------------------

function AccountSection({
  user,
  newsletter,
  savingNewsletter,
  newsletterNote,
  onToggleNewsletter,
  onLogout,
  onAccountDeleted,
}: {
  user: LobbyUser;
  newsletter: boolean;
  savingNewsletter: boolean;
  newsletterNote: string;
  onToggleNewsletter: () => void;
  onLogout: () => void;
  onAccountDeleted: () => void;
}) {
  // Delete-account (anonymize-and-detach): password-gated and irreversible, so it
  // stays behind the same inline confirm the Settings tab uses.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const cancelDelete = () => {
    setConfirmingDelete(false);
    setDeletePassword("");
    setDeleteError(null);
  };

  const submitDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount(deletePassword);
      onAccountDeleted();
    } catch (error) {
      setDeleteError(error instanceof ApiError ? error.message : "Could not delete your account. Try again.");
      setDeleting(false);
    }
  };

  return (
    <section className="lobby-section" aria-labelledby="lobby-account-title">
      <SectionHeading id="lobby-account-title" eyebrow="Account" title="Your account" />
      <div className="lobby-setting">
        <span className="lobby-setting-label">Email</span>
        <span className="lobby-setting-value">
          {maskEmail(user.email)}
          <span className={`lobby-pill${user.emailVerified ? " lobby-pill-ok" : ""}`}>{user.emailVerified ? "Verified" : "Not verified"}</span>
        </span>
      </div>
      <div className="lobby-setting">
        <span className="lobby-setting-label">Season updates newsletter</span>
        <LobbyToggle on={newsletter} disabled={savingNewsletter} label="Season updates newsletter" onToggle={onToggleNewsletter} />
      </div>
      {newsletterNote ? <p className="lobby-note" role="status">{newsletterNote}</p> : null}
      <div className="lobby-setting">
        <span className="lobby-setting-label">Session</span>
        <button className="lobby-btn lobby-btn-small" type="button" onClick={onLogout}>Log out</button>
      </div>
      {confirmingDelete ? (
        <div className="lobby-danger">
          <p className="lobby-note">
            This permanently scrubs your account and signs you out — immediately and for good. Your house and its history stay in the world. Enter your
            password to confirm.
          </p>
          <input
            className="lobby-input"
            type="password"
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Confirm your password to delete your account"
            value={deletePassword}
            disabled={deleting}
            onChange={(event) => setDeletePassword(event.target.value)}
          />
          {deleteError ? <p className="lobby-note lobby-note-error" role="alert">{deleteError}</p> : null}
          <div className="lobby-danger-actions">
            <button className="lobby-btn lobby-btn-small" type="button" disabled={deleting} onClick={cancelDelete}>Cancel</button>
            <button className="lobby-btn lobby-btn-small lobby-btn-danger" type="button" disabled={deleting || !deletePassword} onClick={submitDelete}>
              {deleting ? "Deleting…" : "Confirm deletion"}
            </button>
          </div>
        </div>
      ) : (
        <div className="lobby-setting">
          <span className="lobby-setting-label">Delete account</span>
          <button className="lobby-btn lobby-btn-small lobby-btn-danger" type="button" onClick={() => setConfirmingDelete(true)}>Delete account</button>
        </div>
      )}
    </section>
  );
}
