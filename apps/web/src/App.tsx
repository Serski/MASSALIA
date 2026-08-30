import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ApiError, api, apiErrorMessage } from "./api.js";
import { LegalPage, type LegalPageKind } from "./legal.js";
import { CharacterCreation } from "./CharacterCreation.js";
import { Dashboard } from "./dashboard/Dashboard.js";
import { ProvinceMap } from "./map/ProvinceMap.js";
import { assetPath, nobleHouses, professions, type Alignment, type House, type Profession } from "./data/league.js";

type DetailKind = "profession" | "house" | "party" | "city";
type AuthMode = "login" | "signup";

type Party = {
  kind: "party";
  slug: string;
  initial: string;
  image: string;
  name: string;
  script: string;
  title: string;
  alignment: Alignment;
  formed: string;
  motto: string;
  stipend: string;
  who: string;
  wants: string;
  influence: string;
};

type City = {
  kind: "city";
  slug: string;
  initial: string;
  name: string;
  resource: string;
  capital?: boolean;
  flavor: string;
};

type DetailEntry = Profession | House | Party | City;

const landingStats = {
  houses: "10",
  seasonLabel: "Season I",
  seasonStatus: "Open now",
};

// The Phocaean world around Massalia — its sister-colonies and trading ports, the
// SETTING for the one city you play. These are lore, not places to join: you are a
// citizen of Massalia itself. (`resource` reads as "known for", historical flavor.)
const leagueCities: City[] = [
  { kind: "city", slug: "massalia", initial: "M", name: "Massalia", resource: "Lead", capital: true, flavor: "The great Phocaean city of the western sea — your home, and the seat of the oligarchy you mean to lead." },
  { kind: "city", slug: "emporion", initial: "E", name: "Emporion", resource: "Tin", flavor: "The western tin market on the Iberian coast, where Massalian traders meet the silver roads inland." },
  { kind: "city", slug: "rhoda", initial: "R", name: "Rhoda", resource: "Leather", flavor: "A coastal workshop town of the Phocaean sphere, known for its leatherwork and small ships." },
  { kind: "city", slug: "agathe", initial: "A", name: "Agathe", resource: "Horse", flavor: "A settlement of the open hinterland, prized along the coast for its horses." },
  { kind: "city", slug: "arelate", initial: "A", name: "Arelate", resource: "Wool", flavor: "A river town of tolls and wool, where the Rhône trade flows down to the sea." },
  { kind: "city", slug: "olbia", initial: "O", name: "Olbia", resource: "Wood", flavor: "A timber port whose pine and oak feed the shipwrights of the coast." },
  { kind: "city", slug: "monoikos", initial: "M", name: "Monoikos", resource: "Iron", flavor: "A rugged harbor of iron and watch-forts, guarding the eastern sea-lanes." },
  { kind: "city", slug: "antipolis", initial: "A", name: "Antipolis", resource: "Marble", flavor: "A showcase of the western shore, its public works dressed in marble." },
  { kind: "city", slug: "nikaia", initial: "N", name: "Nikaia", resource: "Stone", flavor: "A walled frontier city of dressed stone above the eastern bays." },
  { kind: "city", slug: "athinopolis", initial: "A", name: "Athinopolis", resource: "Salt", flavor: "A salt town whose pans feed trade, table, and altar alike." },
];

const parties: Party[] = [
  {
    kind: "party",
    slug: "palaioi",
    initial: "P",
    image: assetPath("assets/PALAIOI READY.png"),
    name: "Palaioi",
    script: "PALAIOI",
    title: "The Conservatives",
    alignment: "conservative",
    formed: "360 BC",
    motto: "Preserving the Heritage",
    stipend: "Party Archon: 80 dr./day",
    who: "The old Phocaean aristocracy, families of the first settlers who hold land, temples, and military prestige.",
    wants: "Pure Hellenic tradition, resistance to Gaulish syncretism, and independence from Carthage and Rome.",
    influence: "They draw strength from old families, temples, officer networks, and citizens wary of foreign entanglements.",
  },
  {
    kind: "party",
    slug: "dynatoi",
    initial: "D",
    image: assetPath("assets/DYNATOI READY.png"),
    name: "Dynatoi",
    script: "DYNATOI",
    title: "The Reformists",
    alignment: "reformist",
    formed: "c. 360 BC",
    motto: "Reform for Prosperity",
    stipend: "Party Archon: 80 dr./day",
    who: "Newer progressive families, traders, and diplomats tied to the Gaulish tribes.",
    wants: "A cosmopolitan Massalia open to Gaulish customs, trade expansion into Gaul, and security through alliance.",
    influence: "They rise through merchant wealth, diplomacy, interpreters, and citizens who see survival in adaptation.",
  },
];

const offices = [
  { title: "Archons x2", type: "Elected", pay: "150 dr./day", icon: "assets/offices/ARCHON.webp", description: "Heads of state and chief generals; one must be Palaioi, one Dynatoi." },
  { title: "Ephors x2", type: "Appointed", pay: "60 dr./day", icon: "assets/offices/EPHOR.webp", description: "Checks on the Archons; finances, laws, and calling or dissolving council." },
  { title: "Strategoi x2", type: "Appointed", pay: "100 dr./day", icon: "assets/offices/GENERAL.webp", description: "Command armies with or for the Archons." },
  { title: "Council of Oligarchy", type: "Council", pay: "40 dr./day", icon: "assets/offices/OLIGARCH.webp", description: "Senior family members who approve laws, treaties, war, and budgets." },
];

const detailCollections = {
  professions,
  houses: nobleHouses,
  parties,
  cities: leagueCities,
};

const detailRoutes: Record<DetailKind, keyof typeof detailCollections> = {
  profession: "professions",
  house: "houses",
  party: "parties",
  city: "cities",
};

function getDetailPath(entry: DetailEntry) {
  return `/${detailRoutes[entry.kind]}/${entry.slug}`;
}

function navigateTo(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function Crest({ initial, image, label, className = "" }: { initial: string; image?: string; label: string; className?: string }) {
  return (
    <span className={`crest-medallion${image ? " crest-medallion-image" : ""}${className ? ` ${className}` : ""}`} aria-label={label}>
      {image ? <img src={image} alt="" /> : <span>{initial}</span>}
    </span>
  );
}

function DetailLink({ entry, children, className }: { entry: DetailEntry; children: ReactNode; className: string }) {
  const href = getDetailPath(entry);
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

function AuthPanel({
  mode,
  onModeChange,
  onClose,
  isModal = false,
}: {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose?: () => void;
  isModal?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newsletter, setNewsletter] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Forgot-password sub-view (login mode only): swaps the form for a one-field
  // email prompt; forgotDone flips the message to the generic success line.
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotDone, setForgotDone] = useState(false);
  const isSignup = mode === "signup";

  useEffect(() => {
    const firstField = panelRef.current?.querySelector<HTMLInputElement>("input");
    firstField?.focus();
  }, [mode, forgotOpen]);

  // Leaving login mode (or switching modes) closes the forgot sub-view.
  useEffect(() => {
    setForgotOpen(false);
    setForgotDone(false);
    setMessage("");
  }, [mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (isSignup && !termsAccepted) {
      setMessage("Accept the Terms of Service and Privacy Policy to join the League.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = isSignup ? await api.register(email, password, newsletter, termsAccepted) : await api.login(email, password);
      onClose?.();
      navigateTo(result.hasCharacter ? "/game" : "/create");
    } catch (error) {
      setMessage(apiErrorMessage(error, "auth"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);
    try {
      const result = await api.forgotPassword(email);
      setForgotDone(true);
      // Always the same generic line — the server never reveals whether the email exists.
      setMessage(result.message);
    } catch (error) {
      setForgotDone(false);
      setMessage(apiErrorMessage(error, "auth"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSocial(provider: string) {
    // TODO: Confirm final OAuth provider list and redirect/callback URLs before wiring OAuth.
    setMessage(`TODO: ${provider} OAuth is not connected yet.`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isModal) {
      return;
    }
    if (event.key === "Escape") {
      onClose?.();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      return;
    }
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

  return (
    <div className="auth-scroll-frame" ref={panelRef} onKeyDown={handleKeyDown}>
      <div className="auth-rod auth-rod-top" aria-hidden="true" />
      <div className="auth-rod auth-rod-bottom" aria-hidden="true" />
      <span className="auth-finial auth-finial-top-left" aria-hidden="true" />
      <span className="auth-finial auth-finial-top-right" aria-hidden="true" />
      <span className="auth-finial auth-finial-bottom-left" aria-hidden="true" />
      <span className="auth-finial auth-finial-bottom-right" aria-hidden="true" />
      <div className="auth-tab-toggle" role="tablist" aria-label="Auth mode">
        <button className={mode === "login" ? "active" : ""} type="button" onClick={() => onModeChange("login")}>
          Log In
        </button>
        <button className={mode === "signup" ? "active" : ""} type="button" onClick={() => onModeChange("signup")}>
          Sign Up
        </button>
      </div>
      <div className="auth-meander auth-meander-top" aria-hidden="true" />
      <div className="auth-card">
        <div className="auth-corner auth-corner-tl" aria-hidden="true" />
        <div className="auth-corner auth-corner-tr" aria-hidden="true" />
        <div className="auth-corner auth-corner-bl" aria-hidden="true" />
        <div className="auth-corner auth-corner-br" aria-hidden="true" />
        {onClose ? (
          <button className="auth-close" type="button" onClick={onClose} aria-label="Close authentication panel">
            ×
          </button>
        ) : null}
        <div className="auth-card-inner" role={isModal ? "dialog" : undefined} aria-modal={isModal || undefined} aria-labelledby="auth-title">
          <p className="auth-brandline">The League of Massalia</p>
          <h1 id="auth-title">{isSignup ? "Join the League" : "Enter the League"}</h1>
          <p className="auth-subtitle">
            {isSignup ? "Choose your calling. Pledge a House. Make your name." : "Massalia awaits your return."}
          </p>

          {forgotOpen ? (
            <form className="auth-form" onSubmit={handleForgot}>
              <p className="auth-forgot-lead">Enter your email and we&apos;ll send a link to reset your password.</p>
              <label>
                <span>Email</span>
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="Email address"
                  required
                />
                <i aria-hidden="true">✉</i>
              </label>

              {message ? (
                <p className={`auth-message${forgotDone ? " auth-message-success" : ""}`} role="status">{message}</p>
              ) : null}

              <button className="primary-cta auth-submit" type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Working..." : "Send reset link"}
              </button>

              <p className="auth-switch">
                <button type="button" onClick={() => { setForgotOpen(false); setForgotDone(false); setMessage(""); }}>
                  ← Back to log in
                </button>
              </p>
            </form>
          ) : (
            <>
              <div className="auth-social-row" aria-label="Social sign in">
                {["Discord", "Google", "Facebook"].map((provider) => (
                  <button key={provider} type="button" onClick={() => handleSocial(provider)}>
                    <span aria-hidden="true">{provider[0]}</span>
                    {provider}
                  </button>
                ))}
              </div>

              <div className="auth-divider"><span>or</span></div>

              <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                  <span>Email</span>
                  <input
                    type="email"
                    name="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="Email address"
                    required
                  />
                  <i aria-hidden="true">✉</i>
                </label>
                <label>
                  <span>Password</span>
                  <input
                    type="password"
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    placeholder="Password"
                    minLength={8}
                    required
                  />
                  <i aria-hidden="true">▣</i>
                </label>

                {isSignup ? (
                  <div className="auth-checks">
                    <label>
                      <input type="checkbox" checked={newsletter} onChange={(event) => setNewsletter(event.target.checked)} />
                      <span>Send me season updates and League dispatches.</span>
                    </label>
                    <label>
                      <input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} required />
                      <span>
                        I agree to the <a href="?page=terms" target="_blank" rel="noopener noreferrer">Terms of Service</a> and{" "}
                        <a href="?page=privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                      </span>
                    </label>
                  </div>
                ) : null}

                {message ? <p className="auth-message" role="status">{message}</p> : null}

                <button className="primary-cta auth-submit" type="submit" disabled={isSubmitting || (isSignup && !termsAccepted)}>
                  {isSubmitting ? "Working..." : isSignup ? "Sign up & play free" : "Log in"}
                </button>
              </form>

              {!isSignup ? (
                <button className="auth-forgot" type="button" onClick={() => { setForgotOpen(true); setForgotDone(false); setMessage(""); }}>
                  Forgot your password?
                </button>
              ) : null}

              <p className="auth-switch">
                {isSignup ? "Already a citizen?" : "New to the League?"}{" "}
                <button type="button" onClick={() => onModeChange(isSignup ? "login" : "signup")}>
                  {isSignup ? "Enter the League" : "Found your legacy"} →
                </button>
              </p>
            </>
          )}

          <p className="auth-legal-links">
            <a href="?page=terms" target="_blank" rel="noopener noreferrer">Terms</a>
            {" · "}
            <a href="?page=privacy" target="_blank" rel="noopener noreferrer">Privacy</a>
          </p>
        </div>
      </div>
      <div className="auth-meander auth-meander-bottom" aria-hidden="true" />
    </div>
  );
}

function AuthModal({ mode, onModeChange, onClose }: { mode: AuthMode; onModeChange: (mode: AuthMode) => void; onClose: () => void }) {
  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <div className="auth-modal-shell" onMouseDown={(event) => event.stopPropagation()}>
        <AuthPanel mode={mode} onModeChange={onModeChange} onClose={onClose} isModal />
      </div>
    </div>
  );
}

function AuthRoutePage({ mode }: { mode: AuthMode }) {
  return (
    <main className="landing-shell auth-page-shell">
      <AuthPanel mode={mode} onModeChange={(nextMode) => navigateTo(`/${nextMode}`)} />
    </main>
  );
}

// Reached when the app loads with `?reset=TOKEN` (the emailed link). Sets a new
// password (with a client-side confirm-match check mirroring the server's 8-char
// rule), then enters the app via the standard login-success path. On a rejected
// token it offers to request a fresh link.
function ResetPasswordPage({
  token,
  onSuccess,
  onRequestNew,
}: {
  token: string;
  onSuccess: (result: { hasCharacter: boolean }) => void;
  onRequestNew: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [linkDead, setLinkDead] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setMessage("Those passwords don't match.");
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await api.resetPassword(token, password);
      onSuccess({ hasCharacter: result.hasCharacter });
    } catch (error) {
      // A 400 means the link is invalid/expired — offer a fresh request.
      if (error instanceof ApiError && error.status === 400) {
        setLinkDead(true);
      }
      setMessage(apiErrorMessage(error, "auth"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="landing-shell auth-page-shell">
      <div className="auth-scroll-frame">
        <div className="auth-card">
          <div className="auth-card-inner">
            <p className="auth-brandline">The League of Massalia</p>
            <h1>Set a new password</h1>
            {linkDead ? (
              <>
                <p className="auth-subtitle">{message}</p>
                <button className="primary-cta auth-submit" type="button" onClick={onRequestNew}>
                  Request a new link
                </button>
              </>
            ) : (
              <form className="auth-form" onSubmit={handleSubmit}>
                <label>
                  <span>New password</span>
                  <input
                    type="password"
                    name="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="New password"
                    minLength={8}
                    required
                  />
                  <i aria-hidden="true">▣</i>
                </label>
                <label>
                  <span>Confirm password</span>
                  <input
                    type="password"
                    name="confirm"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    autoComplete="new-password"
                    placeholder="Confirm password"
                    minLength={8}
                    required
                  />
                  <i aria-hidden="true">▣</i>
                </label>

                {message ? <p className="auth-message" role="status">{message}</p> : null}

                <button className="primary-cta auth-submit" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Working..." : "Set password & enter"}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// Reached when the app loads with `?verify=TOKEN` (the emailed verification link).
// Calls verify-email once on mount, clears the param, and shows a brief result:
// success enters the app (self-routing to the dashboard or login); failure shows
// the error with a hint to log in and resend from the banner.
function VerifyEmailPage({
  token,
  onDone,
  onLogin,
}: {
  token: string;
  onDone: () => void;
  onLogin: () => void;
}) {
  const [status, setStatus] = useState<"pending" | "ok" | "error">("pending");
  const [message, setMessage] = useState("Verifying your email…");
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // guard React 18 StrictMode double-invoke
    ranRef.current = true;
    // Strip `?verify=TOKEN` up front (the token is captured in App state) so a
    // refresh can't re-run verification, whatever the outcome.
    window.history.replaceState({}, "", window.location.pathname);
    api.verifyEmail(token)
      .then(() => {
        setStatus("ok");
        setMessage("Email verified.");
      })
      .catch((error) => {
        setStatus("error");
        setMessage(apiErrorMessage(error, "auth"));
      });
  }, [token]);

  return (
    <main className="landing-shell auth-page-shell">
      <div className="auth-scroll-frame">
        <div className="auth-card">
          <div className="auth-card-inner">
            <p className="auth-brandline">The League of Massalia</p>
            <h1>Email verification</h1>
            <p className={`auth-subtitle${status === "ok" ? " auth-message-success" : ""}`} role="status">{message}</p>
            {status === "ok" ? (
              <button className="primary-cta auth-submit" type="button" onClick={onDone}>Continue</button>
            ) : status === "error" ? (
              <>
                <p className="auth-subtitle">Log in and resend a verification email from the banner.</p>
                <button className="primary-cta auth-submit" type="button" onClick={onLogin}>Log in</button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function DetailPage({ entry, onOpenAuth }: { entry: DetailEntry; onOpenAuth: (mode: AuthMode) => void }) {
  const emblem = "image" in entry ? entry.image : undefined;

  return (
    <main className="landing-shell detail-shell">
      <nav className="landing-nav" aria-label="Main">
        <button className="brand-lockup" type="button" onClick={() => navigateTo("/")}>
          <span className="brand-mark" aria-hidden="true">
            <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </span>
          <span>MASSALIA</span>
        </button>
        <div className="nav-primary-links" aria-label="Landing sections">
          <a href="/#world">The World</a>
          <a href="/#factions">Factions</a>
          <a href="/#atlas">Atlas</a>
        </div>
        <div className="nav-actions">
          <button className="nav-button nav-login" type="button" onClick={() => onOpenAuth("login")}>Login</button>
          <button className="nav-button nav-signup" type="button" onClick={() => onOpenAuth("signup")}>Sign Up</button>
        </div>
      </nav>

      <section className="detail-hero">
        <button className="back-link" type="button" onClick={() => navigateTo("/")}>Back to landing</button>
        <div className="detail-heading">
          <Crest initial={entry.initial} image={emblem} label={`${entry.name} ${emblem ? "emblem" : "generic crest"}`} />
          <div>
            <p className="section-eyebrow">{entry.kind}</p>
            <h1>{entry.name}</h1>
            <p className="placeholder-note">{emblem ? "Official emblem." : "Generic crest — swap real logo."}</p>
          </div>
        </div>
        <DetailBody entry={entry} />
      </section>
      <LandingFooter />
    </main>
  );
}

function DetailBody({ entry }: { entry: DetailEntry }) {
  if (entry.kind === "profession") {
    if (entry.narrativePath) {
      return (
        <div className="detail-grid">
          <article className="detail-panel">
            <h2>Objective</h2>
            <p>{entry.objective}</p>
            <p><strong>Starting condition:</strong> {entry.income}</p>
            <p><strong>Starting funds:</strong> No coin, land, or House at start.</p>
            <p>{entry.note}</p>
          </article>
          <article className="detail-panel">
            <h2>Status path</h2>
            <ol className="tier-list">
              {entry.narrativePath.milestones.map((milestone) => (
                <li key={milestone.milestone}>
                  <strong>{milestone.milestone}</strong>
                  <p>{milestone.advance}</p>
                </li>
              ))}
            </ol>
          </article>
        </div>
      );
    }

    return (
      <div className="detail-grid">
        <article className="detail-panel">
          <h2>Objective</h2>
          <p>{entry.objective}</p>
          <p><strong>Starting income:</strong> {entry.income}</p>
          <p><strong>Starting funds:</strong> 150 dr.</p>
          <p>{entry.note}</p>
        </article>
        <article className="detail-panel">
          <h2>Four-tier ladder</h2>
          <ol className="tier-list">
            {entry.tiers.map((tier) => (
              <li key={tier.building}>
                <strong>{tier.building}</strong>
                <span>{tier.rank}</span>
                <p>{tier.benefit}{tier.upkeep ? `; upkeep ${tier.upkeep}` : ""}</p>
              </li>
            ))}
          </ol>
        </article>
      </div>
    );
  }

  if (entry.kind === "house") {
    return (
      <div className="detail-grid">
        <article className="detail-panel">
          <h2>{entry.stance}</h2>
          <p className="party-motto">"{entry.motto}"</p>
          <p><strong>Patron deity:</strong> {entry.patron}</p>
          <p><strong>Famous ancestor:</strong> {entry.ancestor}</p>
          <p><strong>Crest:</strong> {entry.crest}</p>
        </article>
        <article className="detail-panel">
          <h2>House memory</h2>
          <p>{entry.history}</p>
          <p><strong>Defining moment:</strong> {entry.moment}</p>
        </article>
      </div>
    );
  }

  if (entry.kind === "party") {
    return (
      <div className="detail-grid">
        <article className={`detail-panel ${entry.slug}-detail`}>
          <h2>{entry.title}</h2>
          <p className="party-motto">"{entry.motto}"</p>
          <p><strong>Formed:</strong> {entry.formed}</p>
          <p><strong>{entry.stipend}</strong></p>
        </article>
        <article className="detail-panel">
          <h2>Ideology</h2>
          <p><strong>Who they are:</strong> {entry.who}</p>
          <p><strong>What they want:</strong> {entry.wants}</p>
          <p>{entry.influence}</p>
        </article>
      </div>
    );
  }

  return (
    <div className="detail-grid">
      <article className="detail-panel">
        <h2>{entry.capital ? "Massalia — your city" : "A city of the Phocaean world"}</h2>
        <p><strong>Known for:</strong> {entry.resource}</p>
        <p>{entry.flavor}</p>
      </article>
      <article className="detail-panel">
        <h2>One city, not ten</h2>
        <p>You don&apos;t pick a city — you are a citizen of Massalia itself. These Phocaean colonies and ports are the world she leads: the backdrop for your trade, your alliances, and your rivalries, not separate places to join.</p>
      </article>
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="footer-brand">MASSALIA</div>
      <nav aria-label="Legal" className="footer-legal">
        <a href="?page=terms">Terms of Service</a>
        <a href="?page=privacy">Privacy Policy</a>
        <a href="?page=rules">Game Rules</a>
      </nav>
      <small>© 320 BC – MMXXVI · THE LEAGUE OF MASSALIA</small>
    </footer>
  );
}

function getDetailEntry(pathname: string): DetailEntry | undefined {
  const segments = pathname.split("/");
  const collectionName = segments[1];
  const slug = segments[2];
  if (!collectionName || !slug || !(collectionName in detailCollections)) {
    return undefined;
  }
  return detailCollections[collectionName as keyof typeof detailCollections].find((entry) => entry.slug === slug);
}

export function App() {
  const [pathname, setPathname] = useState(window.location.pathname);
  const [authModalMode, setAuthModalMode] = useState<AuthMode | null>(null);
  // Password-reset link: `?reset=TOKEN` on any load (delivered to root, since GitHub
  // Pages 404s SPA paths). Present → the reset screen preempts normal routing.
  const [resetToken, setResetToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("reset"),
  );
  // Static legal pages: `?page=privacy` / `?page=terms` / `?page=rules` (same routing).
  const [legalPage, setLegalPage] = useState<LegalPageKind | null>(() => {
    const page = new URLSearchParams(window.location.search).get("page");
    return page === "privacy" || page === "terms" || page === "rules" ? page : null;
  });
  // Email-verification link: `?verify=TOKEN` on any load.
  const [verifyToken, setVerifyToken] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("verify"),
  );
  const detailEntry = getDetailEntry(pathname);
  const authRouteMode: AuthMode | undefined = pathname === "/login" ? "login" : pathname === "/signup" ? "signup" : undefined;
  const palaioi = parties[0]!;
  const dynatoi = parties[1]!;

  useEffect(() => {
    const handleRoute = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handleRoute);
    return () => window.removeEventListener("popstate", handleRoute);
  }, []);

  const openAuth = (mode: AuthMode) => setAuthModalMode(mode);
  const closeAuth = () => setAuthModalMode(null);
  const startGame = () => navigateTo("/create");

  // Strip `?reset=TOKEN` from the URL so a refresh/back doesn't re-open the flow.
  const clearResetParam = () => {
    window.history.replaceState({}, "", window.location.pathname);
    setResetToken(null);
  };

  if (legalPage) {
    return (
      <LegalPage
        page={legalPage}
        onBack={() => {
          window.history.replaceState({}, "", window.location.pathname);
          setLegalPage(null);
        }}
      />
    );
  }

  if (verifyToken) {
    return (
      <VerifyEmailPage
        token={verifyToken}
        onDone={() => {
          window.history.replaceState({}, "", window.location.pathname);
          setVerifyToken(null);
          navigateTo("/game");
        }}
        onLogin={() => {
          window.history.replaceState({}, "", window.location.pathname);
          setVerifyToken(null);
          navigateTo("/login");
        }}
      />
    );
  }

  if (resetToken) {
    return (
      <ResetPasswordPage
        token={resetToken}
        onSuccess={(result) => {
          clearResetParam();
          navigateTo(result.hasCharacter ? "/game" : "/create");
        }}
        onRequestNew={() => {
          clearResetParam();
          navigateTo("/login");
        }}
      />
    );
  }

  if (pathname === "/game") {
    return <Dashboard onExit={() => navigateTo("/")} onRequireLogin={() => navigateTo("/login")} onRequireCharacter={() => navigateTo("/create")} />;
  }

  // Standalone route for previewing the read-only campaign theatre. The same
  // map is also mounted inside Dashboard → Atlas → Map.
  if (pathname === "/map" || pathname === "/map/") {
    return <ProvinceMap enableFullscreen />;
  }

  if (authRouteMode) {
    return <AuthRoutePage mode={authRouteMode} />;
  }

  if (pathname === "/create") {
    return <CharacterCreation onExit={() => navigateTo("/")} onComplete={() => navigateTo("/game")} />;
  }

  if (detailEntry) {
    return (
      <>
        <DetailPage entry={detailEntry} onOpenAuth={openAuth} />
        {authModalMode ? <AuthModal mode={authModalMode} onModeChange={setAuthModalMode} onClose={closeAuth} /> : null}
      </>
    );
  }

  return (
    <main className="landing-shell">
      <section className="landing-hero" aria-label="Massalia campaign launch">
        <nav className="landing-nav" aria-label="Main">
          <button className="brand-lockup" type="button" onClick={() => navigateTo("/")}>
            <span className="brand-mark" aria-hidden="true">
              <img src={assetPath("assets/MASSALIA LION.png")} alt="" />
            </span>
            <span>MASSALIA</span>
          </button>
          <div className="nav-primary-links" aria-label="Landing sections">
            <a href="#world">The World</a>
            <a href="#roles">Professions</a>
            <a href="#atlas">Atlas</a>
            <a href="#factions">Factions</a>
          </div>
          <div className="nav-actions">
            <button className="nav-button nav-login" type="button" onClick={() => openAuth("login")}>Login</button>
            <button className="nav-button nav-signup" type="button" onClick={startGame}>Sign Up</button>
          </div>
        </nav>

        <section className="hero-content" aria-label="Massalia overview">
          <div className="hero-copy">
            <p className="hero-eyebrow">
              <span className="live-pulse" aria-hidden="true" />
              Free Browser Strategy Game
            </p>
            <p className="hero-lead">4th Century BC · The League Of</p>
            <h1>Massalia</h1>
            <p className="hero-subline">Founded by Phocaean Greeks. Ruled by whoever dares.</p>
            <p className="hero-logline">
              Rise in Massalia, the Greek jewel of the western sea. Choose your calling, join a Noble House, and take a
              side between the old guard and the reformers — then trade, scheme, marry, and campaign your way to the head
              of the city&apos;s oligarchy, building a dynasty that outlives you.
            </p>
            <div className="hero-actions">
              {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
              <button className="primary-cta" type="button" onClick={startGame}>Start The Game</button>
              <p className="cta-note">No download. Play free in your browser.</p>
            </div>
            <dl className="stat-row" aria-label="Live game status">
              <div><dt>Callings to master</dt><dd>{professions.length}</dd></div>
              <div><dt>Noble Houses</dt><dd>{landingStats.houses}</dd></div>
              <div><dt>{landingStats.seasonLabel}</dt><dd>{landingStats.seasonStatus}</dd></div>
            </dl>
          </div>
          <div className="hero-art-focus" aria-hidden="true">
            <img className="hero-lion" src={assetPath("assets/MASSALIA LION.png")} alt="" />
          </div>
        </section>
      </section>

      <section className="landing-section pillars-section" id="world" aria-labelledby="pillars-title">
        <p className="section-eyebrow">What You Do</p>
        <h2 id="pillars-title">Three choices that shape your game</h2>
        <div className="pillar-grid">
          <article className="pillar-card">
            <span className="pillar-kicker">I · Settle</span>
            <h3>Become a Citizen of Massalia</h3>
            <p>Create a citizen of the one great city of the western sea — your name, your face, and the dynasty you mean to found.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">II · Master a Role</span>
            <h3>Choose a Profession</h3>
            <p>Become a trader, landowner, shipbuilder, priest, philosopher, hetaira, military leader, or attempt the hard path from nothing.</p>
          </article>
          <article className="pillar-card">
            <span className="pillar-kicker">III · Scheme</span>
            <h3>House &amp; Politics</h3>
            <p>Pledge to a Noble House, side with Palaioi or Dynatoi, and win the Archonship.</p>
          </article>
        </div>
      </section>

      <section className="landing-section roles-section" id="roles" aria-labelledby="roles-title">
        <p className="section-eyebrow">Professions</p>
        <h2 id="roles-title">Eight paths to power</h2>
        <div className="tile-grid">
          {professions.map((profession) => (
            <DetailLink className={`landing-tile${profession.hardMode ? " profession-hard-mode" : ""}`} entry={profession} key={profession.slug}>
              {profession.hardMode ? <span className="hard-mode-badge">Hard Mode</span> : null}
              <span className="profession-figure">
                <img src={profession.image} alt={profession.name} width="260" height="380" loading="lazy" decoding="async" />
              </span>
              <span className="profession-copy">
                <span className="tile-kicker">{profession.rank}</span>
                <h3>{profession.name}</h3>
                <span className="profession-stat">{profession.income}</span>
                <span className="profession-prompt">View rank ladder →</span>
              </span>
            </DetailLink>
          ))}
        </div>
      </section>

      <section className="landing-section atlas-section" id="atlas" aria-labelledby="atlas-title">
        <div className="atlas-copy">
          <p className="section-eyebrow">Atlas</p>
          <h2 id="atlas-title">Massalia and the Phocaean world</h2>
          <p>Massalia is the shared arena: a 300-seat oligarchy, the elected Archons and Ephors, and two rival parties — power worth fighting over politically, economically, and socially. Around her lie the Phocaean colonies and trading ports of the western sea.</p>
        </div>
        <div className="map-frame" role="img" aria-label="League of Massalia atlas map">
          <img src={assetPath("assets/MAP01.jpg")} alt="" />
        </div>
      </section>

      <section className="landing-section government-section" aria-labelledby="government-title">
        <p className="section-eyebrow">Government</p>
        <h2 id="government-title">The seats of government</h2>
        <div className="office-grid">
          {offices.map((office) => (
            <article className="office-card" key={office.title}>
              <span className="office-watermark" aria-hidden="true">
                <img src={assetPath(office.icon)} alt="" loading="lazy" />
              </span>
              <span className="tile-kicker">{office.type}</span>
              <h3>{office.title}</h3>
              <p>{office.description}</p>
              <strong>{office.pay}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section parties-section" aria-labelledby="parties-title">
        <p className="section-eyebrow">Assembly</p>
        <h2 id="parties-title">Tradition, or reform?</h2>
        <div className="party-duel">
          <DetailLink className="party-card palaioi-card" entry={palaioi}>
            <Crest className="party-watermark" initial={palaioi.initial} image={palaioi.image} label="Palaioi emblem" />
            <div className="party-copy">
              <p className="party-script">{palaioi.script} · {palaioi.name}</p>
              <h3>{palaioi.title}</h3>
              <p className="party-motto">"{palaioi.motto}"</p>
              <p>{palaioi.who}</p>
              <p>{palaioi.wants}</p>
            </div>
          </DetailLink>
          <DetailLink className="party-card dynatoi-card" entry={dynatoi}>
            <Crest className="party-watermark" initial={dynatoi.initial} image={dynatoi.image} label="Dynatoi emblem" />
            <div className="party-copy">
              <p className="party-script">{dynatoi.script} · {dynatoi.name}</p>
              <h3>{dynatoi.title}</h3>
              <p className="party-motto">"{dynatoi.motto}"</p>
              <p>{dynatoi.who}</p>
              <p>{dynatoi.wants}</p>
            </div>
          </DetailLink>
        </div>
      </section>

      <section className="houses-section" id="factions" aria-label="Ten Noble Houses">
        <div className="houses-heading">
          <span className="section-eyebrow">Factions</span>
          <h2>Ten Noble Houses</h2>
        </div>
        <div className="alignment-legend" aria-label="Alignment legend">
          <span><i className="alignment-dot conservative" /> Conservative</span>
          <span><i className="alignment-dot centrist" /> Centrist</span>
          <span><i className="alignment-dot reformist" /> Reformist</span>
        </div>
        <div className="house-tile-grid">
          {nobleHouses.map((house) => (
            <DetailLink className="house-tile" entry={house} key={house.name}>
              <Crest initial={house.initial} image={house.image} label={`${house.name} emblem`} />
              <span className={`house-align ${house.alignment}`}><i className={`alignment-dot ${house.alignment}`} /> {house.stance}</span>
              <h3>{house.name}</h3>
              <p>{house.motto}</p>
            </DetailLink>
          ))}
        </div>
      </section>

      <section className="closing-cta" aria-label="Start playing Massalia">
        <div>
          <p className="section-eyebrow">Season I now open</p>
          <h2>Enter The League of Massalia</h2>
          <p>No download. Play free in your browser.</p>
        </div>
        {/* TODO: If entry is via Discord, change this CTA to "Join the Discord" / "Enter the League" and point it to the invite link. The "Play free in your browser" microcopy may also need to change. */}
        <button className="primary-cta" type="button" onClick={startGame}>Start The Game</button>
      </section>

      <LandingFooter />
      {authModalMode ? <AuthModal mode={authModalMode} onModeChange={setAuthModalMode} onClose={closeAuth} /> : null}
    </main>
  );
}
