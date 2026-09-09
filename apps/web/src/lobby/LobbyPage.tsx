import { useEffect, useRef, useState } from "react";
import { api, ApiError, type LobbyCitizen, type LobbyResponse, type NewsEntry } from "../api.js";
import { maskEmail } from "../dashboard/sheets.js";
import { OFFICE_LABEL, bcYear } from "../dashboard/panels/PoliticsPanel.js";
import { navigateTo } from "../navigate.js";
import { CALENDAR_ANNOUNCED, CALENDAR_ENDED, GUIDES_THUMB, NO_SEAT_PORTRAIT, heroFor } from "./art.js";
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
  // The latest dispatches for the worlds view; null = not fetched or failed.
  const [news, setNews] = useState<NewsEntry[] | null>(null);
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

  // Dispatches are only on the front; a failed fetch just shows the empty line.
  useEffect(() => {
    if (view !== "worlds") return;
    let active = true;
    api
      .news()
      .then((entries) => {
        if (active) setNews(entries);
      })
      .catch(() => {
        if (active) setNews(null);
      });
    return () => {
      active = false;
    };
  }, [view]);

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
        <div className="lobby-shell-grid lobby-shell-grid-two">
          <LeftColumn view={view} user={lobby.user} record={lobby.record} you={lobby.worlds.active?.you ?? null} />
          <div className="lobby-main">
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
        </div>
      ) : view === "hall-of-fame" ? (
        <div className="lobby-shell-grid lobby-shell-grid-two">
          <LeftColumn view={view} user={lobby.user} record={lobby.record} you={lobby.worlds.active?.you ?? null} />
          <div className="lobby-main">
            <HallOfFameSection ended={lobby.worlds.ended} />
          </div>
        </div>
      ) : (
        <div className="lobby-shell-grid">
          <LeftColumn view={view} user={lobby.user} record={lobby.record} you={lobby.worlds.active?.you ?? null} />
          <div className="lobby-main">
            <CentreColumn
              worlds={lobby.worlds}
              newsletter={newsletter}
              savingNewsletter={savingNewsletter}
              onToggleNewsletter={toggleNewsletter}
              onEnterGame={onEnterGame}
              onCreateCharacter={onCreateCharacter}
            />
          </div>
          <RightColumn news={news} citizens={lobby.worlds.active?.citizens ?? []} youCharacterId={lobby.worlds.active?.you?.characterId ?? null} />
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

// --- Right column: guides, dispatches, citizens ---------------------------------

function go(path: string) {
  return (event: { preventDefault: () => void }) => {
    event.preventDefault();
    navigateTo(path);
  };
}

function RightColumn({ news, citizens, youCharacterId }: { news: NewsEntry[] | null; citizens: LobbyCitizen[]; youCharacterId: string | null }) {
  const latest = news ? news.slice(0, 3) : [];
  return (
    <aside className="lobby-aside-right">
      <section className="lobby-panel lobby-guides-box" aria-label="Guides">
        <img className="lobby-guides-thumb" src={GUIDES_THUMB} alt="" width={56} height={56} loading="lazy" />
        <div className="lobby-guides-copy">
          <h3>Guides</h3>
          <p>How the city, the market and the offices work, in one place.</p>
          <a className="lobby-guides-link" href="/guides" onClick={go("/guides")}>Open the guides →</a>
        </div>
      </section>

      <section className="lobby-panel lobby-dispatches" aria-labelledby="lobby-dispatches-title">
        <div className="lobby-panel-head">
          <p className="lobby-eyebrow" id="lobby-dispatches-title">Dispatches</p>
          <a className="lobby-panel-head-link" href="/news" onClick={go("/news")}>All news</a>
        </div>
        {latest.length ? (
          <ul className="lobby-dispatch-list">
            {latest.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.date}>{newsDate(entry.date)}</time>
                <a href="/news" onClick={go("/news")}>{entry.title}</a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lobby-empty lobby-panel-empty">Nothing posted yet.</p>
        )}
      </section>

      <section className="lobby-panel lobby-citizens" aria-labelledby="lobby-citizens-title">
        <div className="lobby-panel-head">
          <p className="lobby-eyebrow" id="lobby-citizens-title">Citizens</p>
          <span className="lobby-panel-head-note">by prestige</span>
        </div>
        {citizens.length ? (
          <ol className="lobby-citizen-list">
            {citizens.map((citizen) => (
              <li className={`lobby-citizen${citizen.characterId !== null && citizen.characterId === youCharacterId ? " lobby-citizen-you" : ""}`} key={citizen.characterId ?? citizen.rank}>
                <span className="lobby-citizen-rank">{ordinal(citizen.rank)}</span>
                <LobbyPortrait portrait={citizen.portrait} faceId={citizen.faceId} professionSlug={citizen.professionSlug} name={citizen.name} size={40} />
                <span className="lobby-citizen-body">
                  <strong>{citizen.name}</strong>
                  <span>{[citizen.houseName, citizen.professionName].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="lobby-empty lobby-panel-empty">No citizens yet.</p>
        )}
      </section>
    </aside>
  );
}

// News dates are calendar days (YYYY-MM-DD), not instants: format them in UTC so
// the day never shifts with the viewer's timezone.
function newsDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
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

// --- Centre column: the League heading, the hero, the calendar -------------------

function CentreColumn({
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
    <>
      <div className="lobby-worlds-head">
        <p className="lobby-eyebrow lobby-worlds-eyebrow">Worlds</p>
        <h2 className="lobby-worlds-title">The League</h2>
      </div>

      {active ? (
        <HeroCard world={active} onEnterGame={onEnterGame} onCreateCharacter={onCreateCharacter} />
      ) : (
        <section className="lobby-panel lobby-no-world">
          <p className="lobby-empty">No world is open.</p>
        </section>
      )}

      {announced.length || ended.length ? (
        <section className="lobby-calendar" aria-labelledby="lobby-calendar-title">
          <h3 className="lobby-calendar-title" id="lobby-calendar-title">Calendar</h3>
          <div className="lobby-calendar-grid">
            {announced.map((world) => (
              <article className="lobby-panel lobby-cal-card" key={world.id}>
                <div className="lobby-cal-head">
                  <h4>{world.name}</h4>
                  <span className="lobby-pill lobby-pill-announced">Announced</span>
                </div>
                <img className="lobby-cal-art" src={CALENDAR_ANNOUNCED} alt="" loading="lazy" />
                <p className="lobby-cal-line">opens on {longDate(world.startsAt)}</p>
                {newsletter ? (
                  <p className="lobby-cal-notified">You&apos;ll be emailed when it opens.</p>
                ) : (
                  <button className="lobby-btn lobby-cal-btn" type="button" disabled={savingNewsletter} onClick={onToggleNewsletter}>
                    Notify me when it opens
                  </button>
                )}
              </article>
            ))}
            {ended.map((world) => (
              <article className="lobby-panel lobby-cal-card" key={world.id}>
                <div className="lobby-cal-head">
                  <h4>{world.name}</h4>
                  <span className="lobby-pill lobby-pill-ended">Ended</span>
                </div>
                <img className="lobby-cal-art" src={CALENDAR_ENDED} alt="" loading="lazy" />
                <p className="lobby-cal-line">
                  closed on {longDate(world.endsAt)} · {count(world.playerCount, "player", "players")}
                </p>
                <button className="lobby-btn lobby-cal-btn" type="button" onClick={() => navigateTo("/lobby/hall-of-fame")}>
                  Hall of fame
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

// The open world: name and OPEN NOW in the head bar, the class building render
// by profession beside the facts, one primary action in the foot.
function HeroCard({ world, onEnterGame, onCreateCharacter }: { world: ActiveWorld; onEnterGame: () => void; onCreateCharacter: () => void }) {
  const you = world.you;
  return (
    <section className="lobby-panel lobby-hero" aria-label={world.name}>
      <div className="lobby-hero-head">
        <h3 className="lobby-hero-name">
          <span className="lobby-pulse" aria-hidden="true" />
          {world.name}
        </h3>
        <span className="lobby-pill">Open now</span>
      </div>
      <div className="lobby-hero-body">
        <div className="lobby-hero-art" style={{ backgroundImage: `url("${heroFor(you?.professionSlug ?? null)}")` }}>
          {world.tagline ? <p className="lobby-hero-tagline">{world.tagline}</p> : null}
        </div>
        <dl className="lobby-hero-facts">
          <div>
            <dt>In-game date</dt>
            <dd>{world.gameDateLabel}</dd>
          </div>
          <div>
            <dt>Season ends in</dt>
            <dd>{count(world.seasonEndsIn, "day", "days")}</dd>
          </div>
          <div>
            <dt>Citizens</dt>
            <dd>{world.playerCount}</dd>
          </div>
          <div>
            <dt>Your rank</dt>
            <dd>{you && you.prestigeRank !== null ? `${you.prestigeRank} by prestige` : "No seat yet"}</dd>
          </div>
        </dl>
      </div>
      <div className="lobby-hero-foot">
        {you ? (
          <button className="lobby-btn lobby-btn-primary lobby-hero-cta" type="button" onClick={onEnterGame}>Continue playing</button>
        ) : (
          <button className="lobby-btn lobby-btn-primary lobby-hero-cta" type="button" onClick={onCreateCharacter}>Found your dynasty</button>
        )}
      </div>
    </section>
  );
}

// --- Hall of Fame ---------------------------------------------------------------

function HallOfFameSection({ ended }: { ended: LobbyResponse["worlds"]["ended"] }) {
  return (
    <section className="lobby-panel lobby-subview" aria-labelledby="lobby-hall-title">
      <SectionHeading id="lobby-hall-title" eyebrow="Hall of Fame" title="Worlds that were" />
      {ended.length ? (
        <div className="lobby-hall">
          {ended.map((world) => (
            <article className="lobby-panel lobby-hall-card" key={world.id}>
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
    <section className="lobby-panel lobby-subview" aria-labelledby="lobby-account-title">
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
