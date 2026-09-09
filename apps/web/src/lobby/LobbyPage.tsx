import { useEffect, useRef, useState } from "react";
import { api, ApiError, type LobbyResponse, type NewsEntry } from "../api.js";
import { assetPath } from "../data/league.js";
import { SvgIcon } from "../dashboard/shared.js";
import { maskEmail } from "../dashboard/sheets.js";
import { GUIDE_CLOSER, GUIDE_FRAMING, GUIDE_READING, GUIDE_READING_HEADER, GUIDE_SECTIONS, GUIDE_TABS, GUIDE_TIP } from "../dashboard/guideContent.js";
import { OFFICE_LABEL, SIDE_LABEL, bcYear, titleCaseVia } from "../dashboard/panels/PoliticsPanel.js";
import { DISCORD_INVITE_URL } from "./links.js";
import "./lobby.css";

// ---------------------------------------------------------------------------
// The account-level Lobby (/lobby): the worlds (the open one and your seat in
// it, the calendar of announced worlds, the ended ones), your record, the news
// of the game, the Hall of Fame (an empty state until results exist), the
// guides, and your account. Everything on this page is a read of GET /api/lobby
// plus the static news file; the only writes are the newsletter opt-in, log
// out and account deletion, through the same api calls the Settings tab uses.
// Styled with lobby- classes over the landing tokens; no dashboard chrome.
// ---------------------------------------------------------------------------

type LobbyPageProps = {
  onEnterGame: () => void;
  onCreateCharacter: () => void;
  onRequireLogin: () => void;
  onLoggedOut: () => void;
};

type ActiveWorld = NonNullable<LobbyResponse["worlds"]["active"]>;
type LobbyUser = LobbyResponse["user"];

const LANDING_LINKS = [
  { href: "/#world", label: "The World" },
  { href: "/#roles", label: "Professions" },
  { href: "/#atlas", label: "Atlas" },
  { href: "/#factions", label: "Factions" },
];

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

// News dates are calendar days (YYYY-MM-DD), not instants: format them in UTC so
// the day never shifts with the viewer's timezone.
function newsDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function LobbyPage({ onEnterGame, onCreateCharacter, onRequireLogin, onLoggedOut }: LobbyPageProps) {
  const [lobby, setLobby] = useState<LobbyResponse | null>(null);
  // null = the news file could not be fetched; the section then shows its empty line.
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
    // A failed news fetch degrades to "Nothing posted yet." — it never fails the page.
    Promise.all([api.lobby(), api.news().catch(() => null)])
      .then(([lobbyData, newsData]) => {
        if (!active) return;
        setLobby(lobbyData);
        setNews(newsData);
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
    <main className="landing-shell lobby-shell">
      <LobbyHeader isAdmin={lobby?.user.isAdmin ?? false} onLogout={logout} />
      {status === "loading" ? (
        <p className="lobby-quiet" role="status" aria-busy="true">Opening the lobby…</p>
      ) : status === "error" || !lobby ? (
        <div className="lobby-quiet" role="alert">
          <p>Could not reach the lobby.</p>
          <button className="lobby-btn" type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      ) : (
        <div className="lobby-grid">
          <div className="lobby-column">
            <WorldsSection
              worlds={lobby.worlds}
              newsletter={newsletter}
              savingNewsletter={savingNewsletter}
              onToggleNewsletter={toggleNewsletter}
              onEnterGame={onEnterGame}
              onCreateCharacter={onCreateCharacter}
            />
            <NewsSection news={news} />
            <HallOfFameSection ended={lobby.worlds.ended} />
          </div>
          <div className="lobby-column">
            <RecordSection user={lobby.user} record={lobby.record} you={lobby.worlds.active?.you ?? null} />
            <GuidesSection />
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
      )}
      <footer className="lobby-footer">
        <nav aria-label="Legal">
          <a href="?page=terms">Terms of Service</a>
          <a href="?page=privacy">Privacy Policy</a>
          <a href="?page=rules">Game Rules</a>
        </nav>
        <small>© 320 BC – MMXXVI · THE LEAGUE OF MASSALIA</small>
      </footer>
    </main>
  );
}

function LobbyHeader({ isAdmin, onLogout }: { isAdmin: boolean; onLogout: () => void }) {
  return (
    <header className="lobby-header">
      <a className="lobby-brand" href="/">
        <span className="brand-mark" aria-hidden="true">
          <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
        </span>
        <span className="lobby-brand-text">
          <span>MASSALIA</span>
          <small>Lobby</small>
        </span>
      </a>
      <nav className="lobby-header-actions" aria-label="Lobby">
        {DISCORD_INVITE_URL ? (
          <a className="lobby-link" href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">Discord</a>
        ) : null}
        {isAdmin ? <a className="lobby-link" href="/admin">Admin</a> : null}
        <button className="lobby-btn lobby-btn-small" type="button" onClick={onLogout}>Log out</button>
      </nav>
    </header>
  );
}

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div className="lobby-section-head">
      <p className="lobby-eyebrow">{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </div>
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
                  <a className="lobby-row-link" href="#lobby-hall">{world.name}</a>
                  <span className="lobby-row-meta">
                    closed on {longDate(world.endsAt)}, {count(world.playerCount, "player", "players")}
                  </span>
                </div>
                <a className="lobby-link" href="#lobby-hall">Hall of Fame ↓</a>
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

// --- Your record ---------------------------------------------------------------

function RecordSection({ user, record, you }: { user: LobbyUser; record: LobbyResponse["record"]; you: ActiveWorld["you"] }) {
  return (
    <section className="lobby-section" aria-labelledby="lobby-record-title">
      <SectionHeading id="lobby-record-title" eyebrow="Your record" title="Across the worlds" />
      <dl className="lobby-facts lobby-facts-stack">
        <div>
          <dt>Worlds played</dt>
          <dd>{record.worldsPlayed}</dd>
        </div>
        {you ? (
          <div>
            <dt>Current dynasty</dt>
            <dd>
              {you.dynastyName ?? you.name}
              {you.generation !== null ? `, ${ordinal(you.generation)} generation` : ""}
            </dd>
          </div>
        ) : null}
        {you && you.prestigeRank !== null ? (
          <div>
            <dt>Rank</dt>
            <dd>
              {you.prestigeRank} of {you.rosterSize} by prestige
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Member since</dt>
          <dd>{monthYear(user.memberSince)}</dd>
        </div>
      </dl>

      <h3 className="lobby-subhead">Offices held</h3>
      {record.offices.length ? (
        <ul className="lobby-list">
          {record.offices.map((office, index) => (
            <li className="lobby-row" key={index}>
              <div className="lobby-row-main">
                <strong>
                  {OFFICE_LABEL[office.office] ?? office.office}
                  {office.side ? ` · ${SIDE_LABEL[office.side] ?? office.side}` : ""}
                </strong>
                <span className="lobby-row-meta">
                  {office.worldName} · {office.endedYear === null ? `${bcYear(office.startedYear)}, sitting` : `${bcYear(office.startedYear)} to ${bcYear(office.endedYear)}`}
                  {office.acquiredVia !== "elected" ? ` · ${titleCaseVia(office.acquiredVia)}` : ""}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="lobby-empty">No office held yet.</p>
      )}
    </section>
  );
}

// --- News --------------------------------------------------------------------

function NewsSection({ news }: { news: NewsEntry[] | null }) {
  return (
    <section className="lobby-section" aria-labelledby="lobby-news-title">
      <SectionHeading id="lobby-news-title" eyebrow="News" title="Dispatches" />
      {news && news.length ? (
        <div className="lobby-news">
          {news.map((entry) => (
            <article className="lobby-news-item" key={entry.id}>
              <p className="lobby-news-meta">
                <time dateTime={entry.date}>{newsDate(entry.date)}</time>
                <span className={`lobby-tag lobby-tag-${entry.tag}`}>{entry.tag}</span>
              </p>
              <h3>{entry.title}</h3>
              {entry.body.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <p className="lobby-empty">Nothing posted yet.</p>
      )}
    </section>
  );
}

// --- Hall of Fame ---------------------------------------------------------------

function HallOfFameSection({ ended }: { ended: LobbyResponse["worlds"]["ended"] }) {
  return (
    <section className="lobby-section" id="lobby-hall" aria-labelledby="lobby-hall-title">
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

// --- Guides --------------------------------------------------------------------
// The in-game Guide's atoms (dashboard/guideContent.tsx) in lobby markup — the
// strings are imported, never copied, so the wording still lives in one place.

function GuidesSection() {
  return (
    <section className="lobby-section" aria-labelledby="lobby-guides-title">
      <SectionHeading id="lobby-guides-title" eyebrow="Guides" title="How the city works" />
      <p className="lobby-guide-p">{GUIDE_FRAMING}</p>

      <h3 className="lobby-subhead">The six tabs</h3>
      <ul className="lobby-guide-tabs">
        {GUIDE_TABS.map((tab) => (
          <li key={tab.name}>
            <span className="lobby-guide-icon" aria-hidden="true">
              <SvgIcon icon={tab.icon} />
            </span>
            <span>
              <strong>{tab.name}</strong>
              <span>{tab.line}</span>
            </span>
          </li>
        ))}
      </ul>

      <h3 className="lobby-subhead">{GUIDE_READING_HEADER}</h3>
      <ul className="lobby-guide-reading">
        {GUIDE_READING.map((item) => (
          <li key={item.name}>
            <strong>{item.name}</strong> — {item.line}
          </li>
        ))}
      </ul>

      <p className="lobby-guide-tip">{GUIDE_TIP}</p>

      {GUIDE_SECTIONS.map((section) => (
        <details className="lobby-guide-section" key={section.id}>
          <summary>{section.title}</summary>
          {section.paragraphs.map((paragraph, index) => (
            <p className="lobby-guide-p" key={index}>{paragraph}</p>
          ))}
        </details>
      ))}

      <p className="lobby-guide-closer">{GUIDE_CLOSER}</p>

      <p className="lobby-landing-links">
        <span>More on the landing:</span>
        {LANDING_LINKS.map((link) => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </p>
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
