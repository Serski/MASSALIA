import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { contentUrl, type PlayerState, type FestivalLive, type OlympiadStatus } from "../api.js";
import { assetPath, nobleHouses, professions, type House, type Profession } from "../data/league.js";
import { portraitPools, type PortraitClassSlug } from "../data/portraits.js";

export type DashboardSection = "court" | "ledger" | "market" | "family" | "politics" | "atlas";

export type IconName = "court" | "ledger" | "market" | "family" | "politics" | "atlas";

export type FourStats = {
  prestige: number;
  devotion: number;
  militia: number;
  intelligence: number;
};

export type PlayerDashboardState = {
  name: string;
  email: string;
  newsletterOptIn: boolean;
  // Written in-game date, e.g. "Winter, 300 BC".
  gameDateLabel: string;
  // Current season name ("Winter".."Autumn"), drives the clock-strip icon.
  seasonName: string;
  seasonEndsIn: number;
  drachmae: number;
  prestige: number;
  influence: number;
  professionSlug: string;
  houseSlug: string;
  classResource: {
    type: string;
    label: string;
    amount: number;
  } | null;
  party: "Palaioi" | "Dynatoi" | "Unaligned";
  // -100 Traditionalist .. +100 Reformist, 0 = centre.
  ideology: number;
  // Active party censure (ideology drift): flag + ISO expiry for the countdown.
  censured: boolean;
  censureExpiresAt: string | null;
  composure: number;
  withdrawn: boolean;
  stats: FourStats;
  balances: Record<string, number>;
  faceImage?: string;
  // Life-arc (age pack).
  currentAge: number;
  lifeStage: string;
  portrait?: string;
  deceased: boolean;
  decaying: string[];
  // The festival live this season (a free civic event), or null.
  festival: FestivalLive | null;
  // The Olympiad cycle status (phase, badges, live event, victor), or null.
  olympiad: OlympiadStatus | null;
  // Manumission: { eligible } when a slave holds the freedman trait, else null.
  manumission: { eligible: boolean } | null;
};

export type PlayerDashboardView = PlayerDashboardState & {
  profession: Profession;
  house: House;
};

export type DigestItem = {
  id: string;
  title: string;
  text: string;
};

// Props shared by every panel. `onRefresh` re-pulls /me/state after a real
// mutation (e.g. joining/leaving a party).
export type PanelProps = { player: PlayerDashboardView; onRefresh: () => void };

// TODO: Replace with real away-summary records.
export const placeholderDigest: DigestItem[] = [
  { id: "trade", title: "Harbor trade", text: "Two wine offers expired while you were away." },
  { id: "house", title: "House Leonidas", text: "Your House gained standing among conservative citizens." },
  { id: "season", title: "Season clock", text: "Season I advanced by one day. The assembly meets soon." },
];

export function normalizeParty(party: string): PlayerDashboardState["party"] {
  if (party.toLowerCase() === "palaioi") return "Palaioi";
  if (party.toLowerCase() === "dynatoi") return "Dynatoi";
  return "Unaligned";
}

export function getFaceImage(professionSlug: string, faceId: string | null) {
  const portraits = portraitPools[professionSlug as PortraitClassSlug] ?? [];
  return portraits.find((portrait) => portrait.id === faceId && !portrait.placeholder)?.image;
}

export function playerFromState(state: PlayerState): PlayerDashboardView {
  const profession = professions.find((item) => item.slug === state.character.professionSlug) ?? professions[0]!;
  const house = nobleHouses.find((item) => item.slug === state.character.houseSlug) ?? nobleHouses[0]!;
  return {
    name: state.character.name,
    email: state.user.email,
    newsletterOptIn: state.user.newsletterOptIn,
    gameDateLabel: state.world.gameDateLabel,
    seasonName: state.world.gameDate?.seasonName ?? "Winter",
    seasonEndsIn: state.world.seasonEndsIn,
    drachmae: state.resources.drachmae,
    prestige: state.resources.prestige,
    influence: state.resources.influence,
    professionSlug: profession.slug,
    houseSlug: house.slug,
    classResource: state.resources.classResource,
    party: normalizeParty(state.character.party),
    // Guard against a missing value (e.g. a frontend/backend deploy-window skew)
    // so the bar degrades to "Centrist (0%)" instead of rendering "NaN%".
    ideology: state.character.ideology ?? 0,
    censured: state.character.censured,
    censureExpiresAt: state.character.censureExpiresAt,
    composure: state.character.composure,
    withdrawn: state.character.withdrawn,
    stats: state.stats,
    balances: state.resources.balances,
    faceImage: getFaceImage(profession.slug, state.character.faceId),
    currentAge: state.character.currentAge,
    lifeStage: state.character.lifeStage,
    portrait: contentUrl(state.character.portrait),
    deceased: state.character.deceased,
    decaying: state.character.decaying ?? [],
    festival: state.festival ?? null,
    olympiad: state.olympiad ?? null,
    manumission: state.manumission ?? null,
    profession,
    house,
  };
}

export function iconPath(icon: IconName) {
  switch (icon) {
    case "court":
      return (
        <>
          <path d="M5 18h14" />
          <path d="M7 18V9l5-4 5 4v9" />
          <path d="M9 18v-5h6v5" />
        </>
      );
    case "ledger":
      return (
        <>
          <path d="M4 20V8l8-4 8 4v12" />
          <path d="M8 20v-7h8v7" />
          <path d="M4 11h16" />
        </>
      );
    case "market":
      return (
        <>
          <path d="M4 10h16l-1-4H5l-1 4Z" />
          <path d="M6 10v9h12v-9" />
          <path d="M9 19v-5h6v5" />
        </>
      );
    case "family":
      return (
        <>
          <circle cx="9" cy="8" r="3" />
          <circle cx="16" cy="9" r="2.5" />
          <path d="M4 20c.8-4 2.7-6 5-6s4.2 2 5 6" />
          <path d="M13 15c1-.8 2-1.2 3-1.2 2 0 3.5 1.8 4 5.2" />
        </>
      );
    case "politics":
      return (
        <>
          <path d="M12 3 4 8l8 5 8-5-8-5Z" />
          <path d="M4 13l8 5 8-5" />
          <path d="M4 17l8 5 8-5" />
        </>
      );
    case "atlas":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16" />
          <path d="M12 4c2 2.2 3 4.8 3 8s-1 5.8-3 8" />
          <path d="M12 4c-2 2.2-3 4.8-3 8s1 5.8 3 8" />
        </>
      );
  }
}

export function SvgIcon({ icon }: { icon: IconName }) {
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">
      {iconPath(icon)}
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg className="dashboard-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function DashboardCard({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <article className={`dashboard-card${className ? ` ${className}` : ""}`} style={style}>{children}</article>;
}

export function ListRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="dashboard-list-row">
      <div>{children}</div>
      {action ? <div className="dashboard-row-action">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable panel building blocks ported from the v8 mockup.
// ---------------------------------------------------------------------------

// Festival display names, keyed by the calendar-config festival id. The content
// has no clean name field (only scene prose), so the human label lives here in the
// presentation layer alongside EVENT_ART, where the rest of the festival chrome is.
export const FESTIVAL_NAMES: Record<string, string> = {
  "fest-dionysia": "Dionysia",
  "fest-artemisia": "Artemisia",
  "fest-apollo": "Apollonia",
};

export function festivalName(festivalId: string): string {
  return FESTIVAL_NAMES[festivalId] ?? "festival";
}

// Scene-art banner slot. Real art is swappable later via the `art` prop; until
// then it renders the gradient placeholder + dashed "scene art" tag.
export function PanelBanner({ scene, art, className = "" }: { scene: string; art?: string; className?: string }) {
  return (
    <div
      className={`panel-banner${className ? ` ${className}` : ""}`}
      style={art ? { backgroundImage: `url("${art}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    >
      {art ? null : <span className="scene-tag">scene art — {scene}</span>}
    </div>
  );
}

export type TraitTone = "good" | "warn" | "neutral";

export function Tchip({ label, tone = "neutral" }: { label: string; tone?: TraitTone }) {
  return <span className={`tchip tone-${tone}`}>{label}</span>;
}

export function PanelRow({
  icon,
  title,
  sub,
  action,
  tag,
  dim = false,
}: {
  // ReactNode so a row can show an image emblem (e.g. a pop crest), not just an emoji.
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
  tag?: string;
  dim?: boolean;
}) {
  return (
    <div className={`panel-row${dim ? " dim" : ""}`}>
      <div className="pr-l">
        <span className="pr-ic" aria-hidden="true">{icon}</span>
        <div>
          <div className="pr-t">{title}</div>
          {sub ? <div className="pr-s">{sub}</div> : null}
        </div>
      </div>
      {action ? action : tag ? <span className="pr-lvl">{tag}</span> : null}
    </div>
  );
}

// A compact −/N/+ stepper for choosing a quantity (hire/dismiss N at once). Clamps
// to [min, max]; max is optional (hiring is bounded by the wallet, not a count).
export function QtyStepper({ value, setValue, min = 1, max }: { value: number; setValue: (n: number) => void; min?: number; max?: number }) {
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  return (
    <span className="qty-stepper" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <button type="button" className="panel-btn ghost" disabled={value <= min} onClick={() => setValue(clamp(value - 1))} aria-label="decrease quantity">−</button>
      <input
        type="number"
        className="qty-input"
        value={value}
        min={min}
        max={max}
        onChange={(e) => setValue(clamp(parseInt(e.target.value, 10) || min))}
        style={{ width: 46, textAlign: "center" }}
        aria-label="quantity"
      />
      <button type="button" className="panel-btn ghost" disabled={max !== undefined && value >= max} onClick={() => setValue(clamp(value + 1))} aria-label="increase quantity">+</button>
    </span>
  );
}

export function StubButton({
  children,
  ghost = false,
  disabled = false,
  message,
  onStub,
}: {
  children: ReactNode;
  ghost?: boolean;
  disabled?: boolean;
  message: string;
  onStub: (message: string) => void;
}) {
  return (
    <button
      type="button"
      className={`panel-btn${ghost ? " ghost" : ""}`}
      disabled={disabled}
      onClick={() => onStub(message)}
    >
      {children}
    </button>
  );
}

export function PersonFaceIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="9" r="4" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </svg>
  );
}

// A person's face: real portrait when present (and loads), else the line-art icon.
// Mirrors ChildPortrait's graceful-fallback pattern so a missing/broken img never shows.
export function PersonFace({ portrait }: { portrait?: string | null }) {
  const [ok, setOk] = useState(true);
  const src = portrait ? contentUrl(portrait) : undefined;
  if (!src || !ok) return <PersonFaceIcon />;
  return <img src={src} alt="" loading="lazy" onError={() => setOk(false)} />;
}

export function PersonRow({
  name,
  nameSuffix,
  role,
  traits,
  right,
  portrait,
}: {
  name: string;
  nameSuffix?: ReactNode;
  role: string;
  traits: { label: string; tone?: TraitTone }[];
  right?: ReactNode;
  portrait?: string | null;
}) {
  return (
    <div className="person-row">
      <span className="person-face">
        <PersonFace portrait={portrait} />
      </span>
      <div className="person-meta">
        <div className="person-name">
          {name}
          {nameSuffix}
        </div>
        <div className="person-role">{role}</div>
        <div className="person-traits">
          {traits.map((trait) => (
            <Tchip key={trait.label} label={trait.label} tone={trait.tone} />
          ))}
        </div>
      </div>
      {right}
    </div>
  );
}

export function DigestList({ items }: { items: { id: string; icon: string; text: ReactNode }[] }) {
  return (
    <div className="pol-aside">
      {items.map((item) => (
        <div className="news-row" key={item.id}>
          <span className="news-ic" aria-hidden="true">{item.icon}</span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

// --- Politics countdown (censure expiry) -----------------------------------
export function remainingSeconds(untilIso: string | null) {
  if (!untilIso) return 0;
  const ms = new Date(untilIso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 1000) : 0;
}

export function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "0s";
  const d = Math.floor(totalSeconds / 86400);
  const h = Math.floor((totalSeconds % 86400) / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function useCountdownSeconds(untilIso: string | null) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(untilIso));
  useEffect(() => {
    setRemaining(remainingSeconds(untilIso));
    if (!untilIso) return;
    const id = window.setInterval(() => {
      const next = remainingSeconds(untilIso);
      setRemaining(next);
      if (next <= 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [untilIso]);
  return remaining;
}

export function ideologyReadout(ideology: number) {
  const abs = Math.abs(ideology);
  if (abs === 0) return "Centrist (0%)";
  return `${abs}% ${ideology < 0 ? "Traditionalist" : "Reformist"}`;
}

// ---------------------------------------------------------------------------
// Panel placeholder data (TODO: real services later).
// ---------------------------------------------------------------------------

// Remaining real time until a window shuts (the ballot/Olympiad countdown).
export function timeUntil(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "closing now";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// A short, human countdown to an ISO instant (e.g. "ready in 5h", "ready in 2d").
export function buildCountdown(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "ready";
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? `ready in ${hours}h` : `ready in ${Math.ceil(hours / 24)}d`;
}

export function formatPerDay(n: number): string {
  return n >= 1 ? String(Math.round(n)) : n.toFixed(1);
}

export const GOOD_ICON: Record<string, string> = {
  grain: "🌾", oliveoil: "🫒", wine: "🍷", chicken: "🐔", timber: "🪵", bull: "🐂", horse: "🐎", herbal: "🌿",
};

// The class building's FULL tier ladder (Your Trade). Generic over every building
// class — it renders catalog.classBuilding.tiers, so the player sees the whole
// progression (built ✓ → current → next [BUILD/UPGRADE] → future, greyed) with
// each tier's provides (income + goods), cost, build time, and upkeep. The
// build/upgrade action sits on the one buildable "next" tier; the rest are
// informational. (Hoplite/slave have no class building, so this never renders for
// them — their Your Trade falls through to the profession/stub path.)
// Capitalised pop-type name for the staffing line (pops aren't goods, so they have
// no goodLabels entry — Slave / Freeman / Citizen).
export function popName(type: string): string {
  return type[0]!.toUpperCase() + type.slice(1);
}

// The pop types a building is SHORT for staffing, given the owned pool — e.g.
// "1 Slave · 1 Freeman", or "" when owned counts cover the requirement. Staffing is
// a shared pool, so this names a HARD shortfall (you own fewer than required of a
// type); when it returns "" but the building is still idle, the pops are simply
// spread across other buildings (callers say so).
export function shortStaff(staffing: Record<string, number>, pops: Record<string, number>): string {
  return Object.entries(staffing)
    .filter(([ty, q]) => (pops[ty] ?? 0) < (q ?? 0))
    .map(([ty, q]) => `${(q ?? 0) - (pops[ty] ?? 0)} ${popName(ty)}`)
    .join(" · ");
}

// Why a building earns nothing: a hard pop shortfall by name, else the shared-pool case.
export function idleReason(staffing: Record<string, number>, pops: Record<string, number>): string {
  const missing = shortStaff(staffing, pops);
  return missing ? `needs ${missing} you don't own` : "your pops are staffing other buildings — hire more";
}

export const POP_ICON: Record<string, string> = { slave: "⛓️", freeman: "🧑", citizen: "🏛️" };

// --- Identity / stat icons (visual polish) ---------------------------------
// Wire the on-disk image assets into their natural places. assetPath() does not
// encode spaces, so encode them here for the " CLEAR.webp" assets. Every icon
// degrades gracefully (AssetIcon hides on error / renders a fallback) so a missing
// file never shows a broken-image glyph. EXACT on-disk filenames — do not rename.
export function assetIconUrl(file: string): string {
  return assetPath(`assets/${file}`).replace(/ /g, "%20");
}

export function AssetIcon({
  file,
  alt,
  className = "asset-icon",
  fallback = null,
}: {
  file: string;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [ok, setOk] = useState(true);
  if (!ok) return <>{fallback}</>;
  return <img src={assetIconUrl(file)} alt={alt} className={className} loading="lazy" onError={() => setOk(false)} />;
}

// House display-name (lowercased) → crest file. Two files differ from the slug
// spelling (Mitliades / Xanthipos); a house without a crest falls back to nothing.
export const HOUSE_CREST: Record<string, string> = {
  kleitos: "Kleitos.png",
  miltiades: "Mitliades.png",
  xanthippos: "Xanthipos.png",
  iason: "Iason.png",
  timon: "Timon.png",
  aristeides: "Aristeides.png",
  herakleides: "Herakleides.png",
  nicanor: "Nicanor.png",
  philon: "Philon.png",
  leonidas: "Leonidas.png",
};
export const POP_WEBP: Record<string, string> = { citizen: "CITIZEN CLEAR.webp", freeman: "FREEMAN CLEAR.webp", slave: "SLAVE CLEAR.webp" };

// A pop/people-unit glyph: the new emblem when present, else the emoji fallback.
export function PopGlyph({ type }: { type: string }) {
  const emoji = <span aria-hidden="true">{POP_ICON[type] ?? "👤"}</span>;
  const file = POP_WEBP[type];
  if (!file) return emoji;
  return <AssetIcon file={file} alt="" className="asset-icon pop-glyph" fallback={emoji} />;
}

// A house crest for a standings row, keyed by the row's house display name.
export function HouseCrest({ house }: { house: string }) {
  const file = HOUSE_CREST[house.toLowerCase()];
  if (!file) return null;
  return <AssetIcon file={file} alt={`House ${house}`} className="asset-icon crest-icon" />;
}

// Display-layer title-case so a slug-derived dynasty name reads "House Leonidas".
export function titleCase(text: string): string {
  return text.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
