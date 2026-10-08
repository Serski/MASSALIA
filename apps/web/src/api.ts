const configuredApiUrl = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error("VITE_API_URL is required for production builds. Refusing to use a localhost API URL.");
}

export const apiBaseUrl = (configuredApiUrl ?? (import.meta.env.DEV ? "http://localhost:3001" : "")).replace(/\/$/, "");

import { sortNews, type AgeConfig, type CharacterSheet, type DeathCause, type GameDate, type NewsEntry } from "@massalia/shared";
import { clearStoredReferral, storedReferral } from "./referral.js";

export type { CharacterSheet } from "@massalia/shared";
export type { AgeConfig } from "@massalia/shared";
export type { NewsEntry } from "@massalia/shared";

type RequestOptions = {
  method?: string;
  body?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// The session is the signed httpOnly cookie the API sets; the web app and API are
// same-site (playmassalia.com / api.playmassalia.com), so every request simply
// carries it via credentials: "include". Nothing about the session is stored here.
// Legacy: sessions from the github.io/railway.app era kept a raw token under the
// localStorage key below and sent it as a Bearer header; main.tsx purges that key
// once at boot.
export const LEGACY_TOKEN_STORAGE_KEY = "massalia_session_token";

// Session HINT. The cookie is httpOnly, so the client cannot tell whether it is
// logged in without a round trip. This boolean is set when a login-shaped call
// succeeds and dropped on logout, account deletion, or any 401 — it carries
// nothing sensitive and grants nothing: the routing layer uses it to skip the
// landing for a returning player (root → /lobby) and to relabel the landing CTAs.
// A stale hint costs one /auth/me round trip, after which it is cleared.
export const SESSION_HINT_KEY = "massalia.session";

function setSessionHint() {
  try {
    localStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {
    // localStorage unavailable (private mode / blocked): the hint is simply absent.
  }
}

function clearSessionHint() {
  try {
    localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

export function apiErrorMessage(error: unknown, context: "auth" | "creation" = "auth") {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return context === "creation"
        ? "Your session is missing or expired. Log in again, then save your character."
        : "Invalid email or password, or your session expired. Please log in again.";
    }
    if (error.status === 400) {
      return error.message;
    }
    if (error.status === 409) {
      if (context === "creation") {
        // Creation conflicts carry their own friendly copy (name taken, already
        // has a character); only the email clash keeps the log-in hint.
        return /email/i.test(error.message) ? "That email is already registered. Log in with it, then return to character creation." : error.message;
      }
      return "That email is already registered. Try logging in instead.";
    }
    if (error.status >= 500) {
      return "The server hit a problem. Try again in a moment.";
    }
    return error.message;
  }
  return "Can't reach the server. Check your connection and try again.";
}

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  const headers: Record<string, string> = {};
  if (options.body) {
    headers["Content-Type"] = "application/json";
  }
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw new Error("Network request failed", { cause: error });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) clearSessionHint();
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data as T;
}

export type AuthResponse = {
  user: { id: string; email: string } | null;
  hasCharacter: boolean;
  emailVerified?: boolean;
  isAdmin?: boolean;
};

// --- Admin views (routes/admin.ts) ---
export type AdminStat = "prestige" | "devotion" | "militia" | "intelligence";
export type AdminCharacter = { characterId: string; playerId: string; worldId: string; name: string; drachmae: number; status: string; isActive: boolean } & Record<AdminStat, number>;
// A character's stats and inventory: every content good and pop type, held or not.
export type AdminUnitRow = {
  id: string;
  source: "trained" | "band";
  unitId: string;
  label: string;
  count: number;
  startCount: number;
  // In that precedence; pledged and moving rows are not editable.
  state: "pledged" | "moving" | "training" | "ready";
  readyAt: string | null;
  contractEndAt: string | null;
  basedAt: string;
  movingTo: string | null;
  arrivesAt: string | null;
  editable: boolean;
};
export type AdminSheet = {
  characterId: string;
  name: string;
  drachmae: number;
  stats: Record<AdminStat, number>;
  goods: { type: string; label: string; amount: number }[];
  pops: { type: string; label: string; count: number; max: number | null }[];
  military: {
    levy: { men: number };
    altar: { good: string; mor: number; until: string } | null; // null when cold or expired
    units: AdminUnitRow[];
  };
};
export type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  emailVerifiedAt: string | null;
  isAdmin: boolean;
  bannedAt: string | null;
  banReason: string | null;
  lastSeenAt: string | null;
  lastIp: string | null;
  characters: AdminCharacter[];
  // The invite promo: who invited this account, and how many it invited.
  referredBy: string | null;
  referralsMade: number;
};
export type AdminCluster = {
  user: { id: string; email: string };
  windowDays: number;
  ips: string[];
  related: { userId: string; email: string; bannedAt: string | null; sharedIps: string[]; lastSeenAt: string }[];
};
export type AdminLogRow = Record<string, unknown> & { id: string; createdAt: string };
// GET /admin/koina: the active world's live koina, each with its treasury and
// its Lesche's phase as they stand now. No posts.
export type AdminKoinon = { id: string; name: string; leaderName: string; members: number; foundedAt: string; treasury: number; hall: "none" | "building" | "open" | "shut" };

export type CreationRequest = {
  classSlug: string;
  houseSlug: string;
  avatarId: string;
  name: string;
};

export type PlayerState = {
  // Server clock at this read (ISO) and the instant the current season ends (the
  // next whole-day step from the world's start): the dashboard's rollover refetch
  // is armed from their difference, never from the device clock.
  now: string;
  seasonEndsAt: string;
  user: { id: string; email: string; newsletterOptIn: boolean; emailVerified: boolean };
  world: {
    id: string;
    name: string;
    // In-game date: 1 real day = 1 season, BC years counting down from 300.
    gameDate: GameDate;
    gameDateLabel: string;
    // Secondary real-time countdown to the end of the 182-day run.
    seasonEndsIn: number;
  };
  character: {
    id: string;
    name: string;
    professionSlug: string;
    professionName: string;
    professionRank: string;
    houseSlug: string;
    houseName: string;
    houseStance: string;
    faceId: string | null;
    // 'none' | 'palaioi' | 'dynatoi'
    party: string;
    // -100 Traditionalist .. +100 Reformist, 0 = centre.
    ideology: number;
    composure: number;
    // Composure break — withdrawn from public life (actions locked).
    withdrawn: boolean;
    drachmae: number;
    // Active party censure (ideology drift): flag + ISO expiry for the countdown.
    censured: boolean;
    censureExpiresAt: string | null;
    origin: string;
    // Life-arc (age pack). portrait ages with the character; `decaying` lists the
    // stats currently declining (never prestige); deceased is display-only.
    avatarId: string | null;
    startAge: number;
    currentAge: number;
    lifeStage: string;
    portrait: string | null;
    deceased: boolean;
    decaying: string[];
    // Regency (Prompt C): set while this character governs for a minor ward.
    regent: RegentBadge | null;
  };
  // A pending succession blocks normal play until an heir is chosen.
  succession: SuccessionState | null;
  // The festival live for the player this season (a free civic event), or null.
  festival: FestivalLive | null;
  // Story offers/resumes for this character (Pack 2). `image` is the start node's
  // art, shown on the offer card.
  stories: Array<{ storyId: string; status: "offered" | "active"; title: string; image?: string }>;
  // The Olympiad cycle status (phase, badges, live event, city-wide victor), or null.
  olympiad: OlympiadStatus | null;
  // City-wide scandal headline: a fresh Notorious Divorcer branding, or null.
  scandal: { name: string } | null;
  // The honest Family nav badge count (unnamed newborns + in-window family notices).
  familyPending: number;
  // The Politics nav badge count: a member's unread koinon posts, or a
  // non-member's unexpired invites.
  koinonPending?: number;
  // Manumission: { eligible } when a slave holds the freedman trait, else flag false.
  manumission: { eligible: boolean } | null;
  // Onboarding first-seen flags: the welcome intro overlay and the character-sheet
  // portrait pulse show while their flag is false (derived from the players row).
  introSeen: boolean;
  sheetSeen: boolean;
  resources: {
    drachmae: number;
    prestige: number;
    influence: number;
    classResource: {
      type: string;
      label: string;
      amount: number;
    } | null;
    // Every per-type balance the player holds (type -> amount).
    balances: Record<string, number>;
  };
  // The 4-stat model: real where a resource row exists, else 0.
  stats: {
    prestige: number;
    devotion: number;
    militia: number;
    intelligence: number;
  };
};

// Story engine projections (Pack 2) — mirror the server's shapes exactly; no
// `next`/`rewards`/unchosen `result` are ever sent. NOTE the asymmetry the server
// produces: start/state expose `choices` as a SIBLING of `node`; advance carries
// `choices` INSIDE the node-now-current.
export type StoryNodeBody = { eyebrow?: string; paragraphs: string[] };
export type StoryNodeView = { id: string; type: "scene" | "terminal"; body: StoryNodeBody; image?: string };
// A locked choice is disabled and wears its requirement; an unlocked one with a
// price wears the price. A choice whose requirement has a fallback carries none
// of the three — it never locks, and its fork stays hidden.
export type StoryChoiceView = { id: string; text: string; locked?: boolean; requirement?: string; price?: number };
export type StoryStateView = { storyId: string; status: string; node: StoryNodeView; choices?: StoryChoiceView[] };
// Post-grant summary of what an advance just applied (mirrors the server shape). It
// appears ONLY on advance responses — never on node/state projections.
export type StoryReward =
  | { kind: "stat"; stat: string; amount: number }
  | { kind: "drachmae"; amount: number }
  | { kind: "trait"; traitId: string; name: string }
  | { kind: "composure"; amount: number }
  | { kind: "good"; good: string; name: string; amount: number };
export type StoryAdvanceView = { resultText: string | null; completed: boolean; node: StoryNodeView & { choices?: StoryChoiceView[] }; rewardsGranted: StoryReward[] };

// The Player Chronicle (Timeline): a dated, generation-tagged life-event, with a
// structured payload the client renders into prose (see renderChronicleEntry).
export type ChronicleType =
  | "marriage"
  | "divorce"
  | "birth"
  | "megas_choregos"
  | "festival_participation"
  | "olympic_selection"
  | "tragedy_phaedra"
  | "tragedy_clytemnestra"
  | "tragedy_medea"
  | "adoption"
  | "gift_received"
  | "poison_illness"
  | "venom_purged"
  | "assassination_survived"
  | "death"
  | "map_action"
  | "holding_reverted"
  | "holding_tribute"
  | "story_line"
  | "koinon"
  | "koinon_muster";

export type ChronicleEntry = {
  seasonIndex: number;
  label: string;
  generation: number;
  type: ChronicleType;
  payload: Record<string, unknown>;
};

// GET /api/lobby — mirrors routes/lobby.ts (LobbyResponse, LobbyCitizen) by hand,
// like the standings shape below. Rank positions only: no raw metric ever
// travels here. Citizens is the top five of the prestige board, nothing more.
export type LobbyCitizen = {
  rank: number;
  characterId: string | null;
  name: string;
  houseName: string;
  professionSlug: string | null;
  professionName: string | null;
  faceId: string | null;
  portrait: string | null;
};

// The invite promo's box in the Lobby: the viewer's code, the content numbers
// and who they invited in this world, each with a state.
export type LobbyReferrals = {
  code: string;
  reward: number;
  perWorld: number;
  invited: Array<{ name: string | null; status: "signed-up" | "playing" | "seated" | "paid" }>;
};
export type LobbyResponse = {
  // beta: the user created a character in World 1 (the Lobby record shows a line).
  user: { email: string; emailVerified: boolean; newsletterOptIn: boolean; isAdmin: boolean; memberSince: string; beta: boolean };
  worlds: {
    active: null | {
      id: string;
      name: string;
      tagline: string | null;
      startedAt: string;
      endsAt: string;
      gameDateLabel: string;
      seasonEndsIn: number;
      playerCount: number;
      citizens: LobbyCitizen[];
      referrals: LobbyReferrals;
      you: null | {
        characterId: string | null;
        name: string;
        houseName: string;
        professionSlug: string | null;
        professionName: string | null;
        // The aged avatar portrait (as /me/state), null without a character row;
        // faceId is the class-portrait fallback.
        portrait: string | null;
        faceId: string | null;
        dynastyName: string | null;
        generation: number | null;
        prestigeRank: number | null;
        rosterSize: number;
      };
    };
    announced: Array<{ id: string; name: string; tagline: string | null; startsAt: string }>;
    ended: Array<{ id: string; name: string; tagline: string | null; startedAt: string; endsAt: string; playerCount: number }>;
  };
  record: {
    worldsPlayed: number;
    offices: Array<{ worldName: string; office: string; side: string | null; startedYear: number; endedYear: number | null; acquiredVia: string }>;
  };
};

// Login-shaped POSTs (register / login / reset-password). The response sets the
// session cookie; the body carries only the user + hasCharacter.
function authenticate(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  return apiFetch<AuthResponse>(path, { method: "POST", body }).then((result) => {
    setSessionHint();
    return result;
  });
}

export const api = {
  // The invite promo: a stored invite code rides along, and is cleared only after
  // a successful sign-up, so a refused one (an email already registered) keeps it
  // for the retry. The signature is unchanged for both sign-up paths.
  register: (email: string, password: string, newsletterOptIn = false, termsAccepted = false) => {
    const referralCode = storedReferral();
    return authenticate("/auth/register", { email, password, newsletterOptIn, termsAccepted, ...(referralCode ? { referralCode } : {}) }).then((result) => {
      clearStoredReferral();
      return result;
    });
  },
  login: (email: string, password: string) => authenticate("/auth/login", { email, password }),
  // Always resolves to the same generic message (enumeration-safe on the server).
  forgotPassword: (email: string) =>
    apiFetch<{ ok: true; message: string }>("/auth/forgot-password", { method: "POST", body: { email } }),
  // Returns the login-shaped AuthResponse (the response sets the session cookie)
  // so the caller can enter the app exactly as after a normal login.
  resetPassword: (token: string, password: string) =>
    authenticate("/auth/reset-password", { token, password }),
  // Soft email verification: verify from the emailed link (no auth needed), or
  // ask for a fresh link while logged in.
  verifyEmail: (token: string) =>
    apiFetch<{ ok: true }>("/auth/verify-email", { method: "POST", body: { token } }),
  resendVerification: () =>
    apiFetch<{ ok: true; message: string }>("/auth/resend-verification", { method: "POST" }),
  // The server clears the session cookie on success.
  logout: () =>
    apiFetch<{ ok: true }>("/auth/logout", { method: "POST" }).finally(() => clearSessionHint()),
  // Anonymize-and-detach. On failure (wrong password, rate-limit, network) the
  // server keeps the session cookie, so the inline retry in Settings still works.
  deleteAccount: (password: string) =>
    apiFetch<{ ok: true }>("/auth/delete-account", { method: "POST", body: { password } }).then((result) => {
      clearSessionHint();
      return result;
    }),
  // /auth/me answers 200 with a null user when logged out (a 403 for a banned
  // account), so the hint is dropped here as well as on the 401 path.
  me: () =>
    apiFetch<AuthResponse>("/auth/me").then((result) => {
      if (!result.user) clearSessionHint();
      return result;
    }),
  // --- Admin (is_admin only; every call is audited server-side) ---
  adminUsers: (q: string, filters: { banned?: boolean; verified?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filters.banned !== undefined) params.set("banned", String(filters.banned));
    if (filters.verified !== undefined) params.set("verified", String(filters.verified));
    const query = params.toString();
    return apiFetch<{ users: AdminUser[] }>(`/admin/users${query ? `?${query}` : ""}`);
  },
  adminCluster: (userId: string) => apiFetch<AdminCluster>(`/admin/users/${userId}/cluster`),
  adminBan: (userId: string, reason: string) => apiFetch<{ ok: true }>(`/admin/users/${userId}/ban`, { method: "POST", body: { reason } }),
  adminUnban: (userId: string, reason: string) => apiFetch<{ ok: true }>(`/admin/users/${userId}/unban`, { method: "POST", body: { reason } }),
  // Manual email verification, for a player whose verification link expired.
  adminVerify: (userId: string, reason: string) => apiFetch<{ ok: true; emailVerifiedAt: string }>(`/admin/users/${userId}/verify`, { method: "POST", body: { reason } }),
  adminDeleteSessions: (userId: string) => apiFetch<{ ok: true; deleted: number }>(`/admin/users/${userId}/sessions/delete`, { method: "POST" }),
  adminAdjustDrachmae: (characterId: string, delta: number, reason: string) =>
    apiFetch<{ ok: true; drachmae: number }>(`/admin/characters/${characterId}/drachmae`, { method: "POST", body: { delta, reason } }),
  adminRename: (characterId: string, name: string) => apiFetch<{ ok: true; name: string }>(`/admin/characters/${characterId}/rename`, { method: "POST", body: { name } }),
  adminSheet: (characterId: string) => apiFetch<AdminSheet>(`/admin/characters/${characterId}/sheet`),
  adminAdjustStat: (characterId: string, stat: AdminStat, delta: number, reason: string) =>
    apiFetch<{ ok: true; value: number }>(`/admin/characters/${characterId}/stats`, { method: "POST", body: { stat, delta, reason } }),
  adminAdjustGoods: (characterId: string, good: string, delta: number, reason: string) =>
    apiFetch<{ ok: true; amount: number }>(`/admin/characters/${characterId}/goods`, { method: "POST", body: { good, delta, reason } }),
  adminAdjustPops: (characterId: string, popType: string, delta: number, reason: string) =>
    apiFetch<{ ok: true; count: number }>(`/admin/characters/${characterId}/pops`, { method: "POST", body: { popType, delta, reason } }),
  adminAdjustUnits: (characterId: string, unitRowId: string, delta: number, reason: string) =>
    apiFetch<{ ok: true; count: number; removed: boolean }>(`/admin/characters/${characterId}/units/${unitRowId}/count`, { method: "POST", body: { delta, reason } }),
  adminRemoveUnits: (characterId: string, unitRowId: string, reason: string) =>
    apiFetch<{ ok: true; removed: true; unitId: string; count: number }>(`/admin/characters/${characterId}/units/${unitRowId}/remove`, { method: "POST", body: { reason } }),
  adminGrantUnits: (characterId: string, unitId: string, count: number, reason: string) =>
    apiFetch<{ ok: true; unitRowId: string; unitId: string; count: number }>(`/admin/characters/${characterId}/units/grant`, { method: "POST", body: { unitId, count, reason } }),
  adminAdjustLevy: (characterId: string, delta: number, reason: string) =>
    apiFetch<{ ok: true; men: number }>(`/admin/characters/${characterId}/levy`, { method: "POST", body: { delta, reason } }),
  adminCoolAltar: (characterId: string, reason: string) =>
    apiFetch<{ ok: true; altar: null }>(`/admin/characters/${characterId}/altar/cool`, { method: "POST", body: { reason } }),
  adminEffects: (characterId: string) => apiFetch<{ effects: AdminLogRow[] }>(`/admin/characters/${characterId}/effects`),
  adminInteractions: (characterId: string) => apiFetch<{ interactions: AdminLogRow[] }>(`/admin/characters/${characterId}/interactions`),
  adminKoina: () => apiFetch<{ koina: AdminKoinon[] }>("/admin/koina"),
  adminKoinonRename: (id: string, name: string, reason: string) => apiFetch<{ ok: true; name: string }>(`/admin/koina/${id}/rename`, { method: "POST", body: { name, reason } }),
  adminKoinonDissolve: (id: string, reason: string) => apiFetch<{ ok: true; name: string; members: number }>(`/admin/koina/${id}/dissolve`, { method: "POST", body: { reason } }),
  createCharacter: (payload: CreationRequest) => apiFetch("/characters", { method: "POST", body: payload }),
  state: () => apiFetch<PlayerState>("/me/state"),
  // The Player Chronicle (Timeline): the house's dated, generation-tagged history.
  chronicle: () => apiFetch<{ entries: ChronicleEntry[] }>("/me/chronicle"),
  setNewsletter: (optIn: boolean) =>
    apiFetch<{ ok: true; newsletterOptIn: boolean }>("/me/newsletter", { method: "POST", body: { optIn } }),
  // Mark an onboarding step as seen (first-seen is immutable server-side; repeat
  // calls are no-op acks). Fire-and-optimistic: callers hide the UI regardless.
  onboardingSeen: (step: "intro" | "sheet") =>
    apiFetch<{ ok: true }>("/me/onboarding", { method: "POST", body: { step } }),
  joinParty: (party: "dynatoi" | "palaioi") =>
    apiFetch<{ party: string }>("/api/party/join", { method: "POST", body: { party } }),
  leaveParty: () => apiFetch<{ party: string }>("/api/party/leave", { method: "POST" }),
  character: () => apiFetch<{ character: CharacterSheet }>("/api/character"),
  events: () => apiFetch<GameEvent[]>("/api/events"),
  dailyEvents: () => apiFetch<DailySet>("/api/events/daily"),
  resolveEvent: (eventId: string, choiceId: string) =>
    apiFetch<EventResolution>(`/api/events/${eventId}/choices/${choiceId}`, { method: "POST" }),
  // Story engine (Pack 2). start = fresh start OR mid-story resume (idempotent).
  storyStart: (storyId: string) => apiFetch<StoryStateView>(`/api/stories/${storyId}/start`, { method: "POST" }),
  storyAdvance: (storyId: string, choiceId: string) =>
    apiFetch<StoryAdvanceView>(`/api/stories/${storyId}/choices/${choiceId}`, { method: "POST" }),
  storyState: (storyId: string) => apiFetch<StoryStateView>(`/api/stories/${storyId}`),
  routines: () => apiFetch<RoutineSet>("/api/routines"),
  resolveRoutine: (routineId: string) =>
    apiFetch<RoutineResult>("/api/routines/resolve", { method: "POST", body: { routineId } }),
  // Age config (avatars + age options) — served statically; public, for signup.
  ageConfig: () => apiFetch<AgeConfig>("/content/age/age-config.json"),
  family: () => apiFetch<FamilyState>("/api/family"),
  marry: (candidateId: string) => apiFetch<MarryResult>("/api/family/marry", { method: "POST", body: { candidateId } }),
  giveGift: () => apiFetch<{ ok: true; philia: number; delta: number; diminished: boolean }>("/api/family/gift", { method: "POST" }),
  holdSymposium: () => apiFetch<{ ok: true; philia: number; delta: number; prestige: number }>("/api/family/symposium", { method: "POST" }),
  divorce: () => apiFetch<{ ok: true; tier: "full" | "fallen"; penalties: { prestige: number; devotion: number; composure: number; partyFavor: number; drachmae: number }; branded: boolean }>("/api/family/divorce", { method: "POST" }),
  startLoverPlot: () => apiFetch<{ ok: true; loverState: string }>("/api/family/lover", { method: "POST" }),
  nameChild: (childId: string, name: string) =>
    apiFetch<{ ok: boolean; name: string }>(`/api/family/children/${childId}/name`, { method: "POST", body: { name } }),
  succeed: (candidateId?: string) =>
    apiFetch<{ ok: true; heirName: string; kind: string }>("/api/family/succeed", { method: "POST", body: { candidateId } }),
  adopt: (candidateId: string) =>
    apiFetch<{ ok: true; heirName: string; endedRegency: boolean }>("/api/family/adopt", { method: "POST", body: { candidateId } }),
  setHeirPreference: (preference: "blood" | "adopted") =>
    apiFetch<{ ok: true; preference: string }>("/api/family/heir-preference", { method: "POST", body: { preference } }),
  resolveFestival: (festivalId: string, choiceId: string) =>
    apiFetch<EventResolution>("/api/festivals/resolve", { method: "POST", body: { festivalId, choiceId } }),
  // The Olympiad (Prompt 8): the voting ballot, casting a vote, resolving the
  // live Olympic event (nominate / the Games).
  olympicBallot: () => apiFetch<OlympiadBallot>("/api/olympics/ballot"),
  olympicVote: (candidateId: string) =>
    apiFetch<{ ok: true; candidateId: string }>("/api/olympics/vote", { method: "POST", body: { candidateId } }),
  resolveOlympic: (choiceId: string) =>
    apiFetch<OlympicResolution>("/api/olympics/resolve", { method: "POST", body: { choiceId } }),
  // Manumission: the freedman's choice of citizen class, and claiming it.
  manumission: () => apiFetch<ManumissionOptions>("/api/manumission"),
  manumit: (classId: string) =>
    apiFetch<ManumitResult>("/api/manumission", { method: "POST", body: { classId } }),
  // The Oligarchy Chamber (Politics Prompt 1): the 300-seat hemicycle, buying a
  // dynastic seat, and the yearly chamber vote with its public ballot ledger.
  oligarchyChamber: () => apiFetch<ChamberView>("/api/oligarchy/chamber"),
  buySeat: () => apiFetch<{ ok: true; seatIndex: number; price: number }>("/api/oligarchy/buy-seat", { method: "POST" }),
  chamberVotes: () => apiFetch<ChamberVotesView>("/api/oligarchy/votes"),
  castChamberVote: (choice: "yes" | "no") =>
    apiFetch<{ ok: true; choice: "yes" | "no" }>("/api/oligarchy/vote", { method: "POST", body: { choice } }),
  // Archon & Ephor elections (Politics Prompt 2): the cycle ballot, declaring,
  // the secret vote, the current offices, the ledger, and appointments.
  elections: () => apiFetch<ElectionsView>("/api/elections"),
  declareCandidacy: (office: LeagueOffice, side?: OfficeSide) =>
    apiFetch<{ ok: true; office: LeagueOffice; side: OfficeSide }>("/api/elections/declare", { method: "POST", body: { office, side } }),
  castElectionVote: (office: LeagueOffice, candidateCharacterId: string) =>
    apiFetch<{ ok: true }>("/api/elections/vote", { method: "POST", body: { office, candidateCharacterId } }),
  offices: () => apiFetch<OfficesView>("/api/offices"),
  officeAppointees: (side: OfficeSide | "") =>
    apiFetch<{ appointees: OfficeAppointee[] }>(`/api/offices/appointees${side ? `?side=${side}` : ""}`),
  appointEphor: (side: OfficeSide, candidateCharacterId: string) =>
    apiFetch<{ ok: true }>("/api/offices/appoint-ephor", { method: "POST", body: { side, candidateCharacterId } }),
  appointStrategos: (candidateCharacterId: string) =>
    apiFetch<{ ok: true }>("/api/offices/appoint-strategos", { method: "POST", body: { candidateCharacterId } }),
  // Player Standings (Atlas Phase 1): five rank-only leaderboards for the world.
  standings: () => apiFetch<StandingsResponse>("/api/standings"),
  // The account-level Lobby (worlds, your record, account) and the news feed —
  // a content file served statically (see ageConfig), re-sorted newest first
  // here in case the file on disk is not.
  lobby: () => apiFetch<LobbyResponse>("/api/lobby"),
  news: () => apiFetch<NewsEntry[]>("/content/news/news.json").then(sortNews),
  // Player→player interactions (Interaction Pipeline, Prompt 1): the public
  // profile behind a hemicycle seat / standings row, and the give-drachmae action.
  publicProfile: (characterId: string) => apiFetch<PublicProfileView>(`/api/interactions/profile/${characterId}`),
  giveDrachmae: (targetCharacterId: string, amount: number) =>
    apiFetch<{ ok: true; amount: number; wallet: number }>("/api/interactions/give", { method: "POST", body: { targetCharacterId, amount } }),
  poison: (targetCharacterId: string) =>
    apiFetch<{ ok: true; outcome: PoisonOutcome }>("/api/interactions/poison", { method: "POST", body: { targetCharacterId } }),
  assassinate: (targetCharacterId: string) =>
    apiFetch<{ ok: true; outcome: AssassinateOutcome }>("/api/interactions/assassinate", { method: "POST", body: { targetCharacterId } }),
  treat: () => apiFetch<{ ok: true }>("/api/interactions/treat", { method: "POST" }),
  setSpymasterPosture: (posture: "guard" | "hunt") =>
    apiFetch<{ ok: true; posture: string }>("/api/interactions/spymaster-posture", { method: "POST", body: { posture } }),
  // Atlas Phase 2a: the nine League colonies (with five stats each) and the
  // nineteen neighbouring factions (stance + vassal). Static seeded values.
  leagueCities: () => apiFetch<LeagueCitiesResponse>("/api/league/cities"),
  diplomacy: () => apiFetch<DiplomacyResponse>("/api/league/diplomacy"),
  // The Agenda & three governments (Politics Prompt 3).
  agenda: () => apiFetch<AgendaView>("/api/agenda"),
  draftAgenda: (scope: AgendaScope, cardId: string) =>
    apiFetch<{ ok: true }>("/api/agenda/draft", { method: "POST", body: { scope, cardId } }),
  vetoAgenda: (scope: AgendaScope) =>
    apiFetch<{ ok: true }>("/api/agenda/veto", { method: "POST", body: { scope } }),
  endorse: (electionId: string, candidateCharacterId: string) =>
    apiFetch<{ ok: true }>("/api/agenda/endorse", { method: "POST", body: { electionId, candidateCharacterId } }),
  // The Ledger / player economy (Economy Build 1): the building catalog, owned
  // buildings, build/upgrade/collect, and the banded NPC-agora vendor.
  buildingsCatalog: () => apiFetch<BuildingsCatalog>("/api/buildings"),
  buildingsMine: () => apiFetch<BuildingsMine>("/api/buildings/mine"),
  buildBuilding: (buildingId: string) =>
    apiFetch<{ ok: true; buildingId: string; tier: number; completesAt: string; cost: number }>("/api/buildings/build", { method: "POST", body: { buildingId } }),
  upgradeBuilding: (buildingId: string) =>
    apiFetch<{ ok: true; buildingId: string; tier: number; completesAt: string; cost: number }>("/api/buildings/upgrade", { method: "POST", body: { buildingId } }),
  collectBuildings: () => apiFetch<CollectResult>("/api/buildings/collect", { method: "POST" }),
  vendorTrade: (action: "buy" | "sell", type: string, qty: number) =>
    apiFetch<VendorResult>("/api/buildings/vendor", { method: "POST", body: { action, type, qty } }),
  people: () => apiFetch<PeopleView>("/api/buildings/people"),
  hirePeople: (popType: string, count: number) =>
    apiFetch<HireResult>("/api/buildings/hire", { method: "POST", body: { popType, count } }),
  dismissPeople: (popType: string, count: number) =>
    apiFetch<DismissResult>("/api/buildings/dismiss", { method: "POST", body: { popType, count } }),
  // The player market (market prompt 1): sell-only stalls between citizens.
  market: () => apiFetch<MarketView>("/api/market"),
  marketList: (good: string, qty: number, price: number) =>
    apiFetch<MarketListResult>("/api/market/list", { method: "POST", body: { good, qty, price } }),
  marketBuy: (listingId: string, qty: number) => apiFetch<MarketBuyResult>("/api/market/buy", { method: "POST", body: { listingId, qty } }),
  marketCancel: (listingId: string) => apiFetch<MarketCancelResult>("/api/market/cancel", { method: "POST", body: { listingId } }),
  // The koinon (koinon prompt 1): a player-made company of citizens.
  koinon: () => apiFetch<KoinonPage>("/api/koinon"),
  koinonArmies: () => apiFetch<KoinonArmies>("/api/koinon/armies"),
  koinonFound: (name: string) => apiFetch<{ ok: true; koinonId: string; name: string; wallet: number }>("/api/koinon/found", { method: "POST", body: { name } }),
  koinonInvite: (name: string) => apiFetch<{ ok: true }>("/api/koinon/invite", { method: "POST", body: { name } }),
  koinonWithdraw: (inviteId: string) => apiFetch<{ ok: true }>("/api/koinon/withdraw", { method: "POST", body: { inviteId } }),
  koinonAccept: (inviteId: string) => apiFetch<{ ok: true }>("/api/koinon/accept", { method: "POST", body: { inviteId } }),
  koinonDecline: (inviteId: string) => apiFetch<{ ok: true }>("/api/koinon/decline", { method: "POST", body: { inviteId } }),
  koinonLeave: () => apiFetch<{ ok: true; dissolved: boolean }>("/api/koinon/leave", { method: "POST" }),
  koinonExpel: (playerId: string) => apiFetch<{ ok: true }>("/api/koinon/expel", { method: "POST", body: { playerId } }),
  koinonVice: (playerId: string | null) => apiFetch<{ ok: true }>("/api/koinon/vice", { method: "POST", body: { playerId } }),
  koinonHandOver: (playerId: string) => apiFetch<{ ok: true }>("/api/koinon/handover", { method: "POST", body: { playerId } }),
  koinonTakeLead: () => apiFetch<{ ok: true }>("/api/koinon/take-lead", { method: "POST" }),
  koinonPost: (body: string) => apiFetch<{ ok: true; postId: string }>("/api/koinon/post", { method: "POST", body: { body } }),
  koinonPostDelete: (postId: string) => apiFetch<{ ok: true }>("/api/koinon/post/delete", { method: "POST", body: { postId } }),
  koinonRead: () => apiFetch<{ ok: true }>("/api/koinon/read", { method: "POST" }),
  koinonGive: (amount: number) => apiFetch<{ ok: true; wallet: number; treasury: number }>("/api/koinon/give", { method: "POST", body: { amount } }),
  koinonBuildLesche: () => apiFetch<{ ok: true; completesAt: string; treasury: number }>("/api/koinon/lesche", { method: "POST" }),
  // The Raid muster (koinon prompt 3). `mine` settles the caller, as the Barracks
  // read does: fetch it on open and after an action, never on an interval.
  koinonMusterTargets: (gatherId?: string) => apiFetch<KoinonMusterTargets>(`/api/koinon/muster/targets${gatherId ? `?gather=${encodeURIComponent(gatherId)}` : ""}`),
  koinonMusterMine: () => apiFetch<KoinonMusterMine>("/api/koinon/muster/mine"),
  koinonMusterOpen: (input: { regionId?: string; townId?: string; gatherId: string; leadMinutes: number }) =>
    apiFetch<{ ok: true; musterId: string; launchAt: string }>("/api/koinon/muster/open", { method: "POST", body: input }),
  koinonMusterPledge: (input: { rows?: { rowId: string; count: number }[]; ships?: Record<string, number> }) => apiFetch<{ ok: true }>("/api/koinon/muster/pledge", { method: "POST", body: input }),
  koinonMusterWithdraw: () => apiFetch<{ ok: true }>("/api/koinon/muster/withdraw", { method: "POST" }),
  koinonMusterCancel: () => apiFetch<{ ok: true }>("/api/koinon/muster/cancel", { method: "POST" }),
  // The Barracks (military prompt 2). GET settles and returns the view; every POST
  // returns the same BarracksView so the tab re-renders from one payload. Errors
  // are the server's one-line message via ApiError.
  barracks: () => apiFetch<BarracksView>("/api/barracks"),
  barracksRecruit: (unitId: string, count: number) =>
    apiFetch<BarracksView>("/api/barracks/recruit", { method: "POST", body: { unitId, count } }),
  barracksHire: (bandId: string) => apiFetch<BarracksView>("/api/barracks/hire", { method: "POST", body: { bandId } }),
  barracksSacrifice: (good: string) => apiFetch<BarracksView>("/api/barracks/sacrifice", { method: "POST", body: { good } }),
  barracksDisband: (rowId: string) => apiFetch<BarracksView>("/api/barracks/disband", { method: "POST", body: { rowId } }),
  barracksCancel: (rowId: string) => apiFetch<BarracksView>("/api/barracks/cancel", { method: "POST", body: { rowId } }),
  // A battle report opened for the first time (raids prompt 4): the highlight goes. Answers the view.
  barracksReportRead: (marchId: string) => apiFetch<BarracksView>("/api/barracks/report-read", { method: "POST", body: { marchId } }),
  // Map reach (military prompt 3a): which land provinces the player's force can
  // Attack, Raid or Colonise from its bases, with a one-line reason when not.
  mapReach: () => apiFetch<MapReachView>("/api/map/reach"),
  // Map actions (military prompt 3b; raids prompt 4): Scout, Raid or Attack a
  // townless region or a town with roster rows. Sends the party and answers the
  // set-out report with fresh reach and roster payloads; the battle is fought
  // when the party arrives, and its report waits in the Barracks.
  // `ships` (optional): the hulls to sail with, by ship id; absent, the server assembles the crossing.
  mapAct: (type: MapActType, target: MapActTarget, rows: { rowId: string; count: number }[], ships?: Record<string, number>) =>
    apiFetch<MapActResponse<MapSetOutReport>>("/api/map/act", { method: "POST", body: { type, ...target, rows, ...(ships ? { ships } : {}) } }),
  // Move (military prompt 3c): rows from one base to another place of the player's
  // (Massalia's region, home ground, or a holding). Same response shape as an action.
  mapMove: (baseId: string, rows: { rowId: string; count: number }[]) =>
    apiFetch<MapActResponse<MapMoveReport>>("/api/map/act", { method: "POST", body: { type: "move", baseId, rows } }),
  craftGood: (good: string) => apiFetch<CraftResult>("/api/buildings/craft", { method: "POST", body: { good } }),
  // The hoplite's home army (Hoplite Step 1): rank ladder + daily salary.
  service: () => apiFetch<ServiceView>("/api/service"),
  enlistService: () => apiFetch<ServiceActionResult>("/api/service/enlist", { method: "POST" }),
  promoteService: () => apiFetch<ServiceActionResult>("/api/service/promote", { method: "POST" }),
  collectService: () => apiFetch<ServiceActionResult>("/api/service/collect", { method: "POST" }),
  // Re-class (Step 5): the hoplite leaves soldiering for a new trade (one-way).
  reclassService: (targetClass: string) => apiFetch<ReclassResult>("/api/service/reclass", { method: "POST", body: { targetClass } }),
  // Mercenary contracts (Hoplite Step 2): the hiring board + go/return lifecycle.
  mercBoard: () => apiFetch<MercBoard>("/api/merc/board"),
  takeContract: (contractId: string) => apiFetch<MercActionResult>("/api/merc/take", { method: "POST", body: { contractId } }),
  cancelContract: () => apiFetch<MercActionResult>("/api/merc/cancel", { method: "POST" }),
  collectForeign: () => apiFetch<MercActionResult>("/api/merc/collect", { method: "POST" }),
};

// --- Archon & Ephor elections (Politics Prompt 2) ---------------------------

export type LeagueOffice = "archon" | "ephor";
export type OfficeSide = "palaioi" | "dynatoi";

export type ElectionBallotCandidate = {
  characterId: string;
  side: OfficeSide;
  name: string;
  houseName: string;
  party: string;
  prestige: number;
};

export type ElectionOfficeView = {
  office: LeagueOffice;
  phase: "declaration" | "voting" | "resolved";
  declarationEndsAt: string;
  votingEndsAt: string;
  candidates: ElectionBallotCandidate[];
  // The voter's OWN choice (secret — others never see it).
  yourVote: string | null;
  youMayDeclare: { palaioi: boolean; dynatoi: boolean };
  youAreCandidate: boolean;
};

export type ElectionsView = {
  hasOpenElection: boolean;
  offices: ElectionOfficeView[];
  nextElectionYear: number | null;
};

export type OfficeHolder = { characterId: string; name: string; houseName: string; party: string };

export type OfficeSeatView = {
  office: LeagueOffice | "strategos";
  side: OfficeSide | null;
  seatSlot: number;
  holder: OfficeHolder | null;
  acquiredVia: string | null;
  termEndsYear: number | null;
  youMayAppoint: boolean;
};

export type OfficeLedgerEntry = {
  holderName: string;
  houseName: string;
  office: string;
  side: string | null;
  startedYear: number;
  endedYear: number | null;
  acquiredVia: string;
};

export type OfficesView = {
  seats: OfficeSeatView[];
  ledger: OfficeLedgerEntry[];
  houseTallies: { houseName: string; archonships: number; ephorships: number }[];
};

// --- The Agenda & three governments (Politics Prompt 3) ---------------------

export type AgendaScope = "league" | "palaioi" | "dynatoi";

export type AgendaCardView = { id: string; title: string; description: string; cost: number; partyLean: string };

export type TreasuryView = {
  owner: AgendaScope;
  balance: number;
  ledger: { delta: number; reason: string; createdAt: string }[];
};

export type AgendaScopeView = {
  scope: AgendaScope;
  phase: "drafting" | "voting" | "resolved" | null;
  gameYear: number | null;
  cards: AgendaCardView[];
  draftedCardId: string | null;
  vetoedCardId: string | null;
  treasury: TreasuryView;
  youMayDraft: boolean;
  youMayVeto: boolean;
};

export type PartyLeaderView = {
  office: "party_archon" | "party_ephor";
  party: "palaioi" | "dynatoi";
  holder: { characterId: string; name: string } | null;
  youHold: boolean;
};

export type AgendaView = {
  league: AgendaScopeView;
  palaioi: AgendaScopeView;
  dynatoi: AgendaScopeView;
  leaders: PartyLeaderView[];
};

export type OfficeAppointee = { characterId: string; name: string; houseName: string; party: string };

// --- Player Standings (Atlas Phase 1) ---------------------------------------

// The five leaderboards. "wealth" ranks by drachmae; the rest by the named stat.
export type StandingsBoard = "prestige" | "wealth" | "devotion" | "militia" | "intelligence";

// A leaderboard row — rank position only, by design. The server never sends the
// underlying stat value.
export type StandingRow = {
  rank: number;
  playerId: string;
  // The public-profile key — null for a legacy player with no character row.
  characterId: string | null;
  name: string;
  house: string;
  classId: string;
  isViewer: boolean;
};

export type StandingsResponse = {
  boards: Record<StandingsBoard, StandingRow[]>;
};

// --- League world-state (Atlas Phase 2a) ------------------------------------

export type CityGroup = "metropolis" | "eastern" | "western";

// A colony with its five current stats (real values; not rank-hidden).
export type CityView = {
  id: string;
  name: string;
  group: CityGroup;
  population: number;
  tax: number;
  stability: number;
  // 1..5 fortification level (display-only this phase).
  fortifications: number;
  garrison: number;
};

export type LeagueCitiesResponse = { cities: CityView[] };

export type FactionGroup = "gauls" | "celto-ligurian" | "ligurian" | "aquitani" | "iberian" | "major-powers";

// A faction character (Diplomacy D3) with a live, calendar-derived age. Stats are
// raw 0..100 (NPC scouting intel — shown as numbers, unlike the player's own sheet).
export type FactionCharacterView = {
  name: string;
  sex: "M" | "F";
  age: number;
  prestige: number;
  devotion: number;
  militia: number;
  intelligence: number;
};
export type RulerView = FactionCharacterView & { title: string };
export type HeirView = FactionCharacterView & { rel: string };
export type FactionRefView = { id: string; name: string };

// A neighbouring faction with its −200..+200 opinion bar (Diplomacy D1). The five
// middle stances are display bands of `opinion`; War/Allied are latched flags.
export type FactionView = {
  id: string;
  name: string;
  group: FactionGroup;
  // Durable identity-only lore blurb (Diplomacy D2) — static content, not stance.
  blurb: string;
  opinion: number;
  // Display band computed from opinion + a −2..+2 value for colour/order.
  band: string;
  bandLabel: string;
  bandValue: number;
  atWar: boolean;
  allied: boolean;
  vassal: boolean;
  // Governance + people (Diplomacy D3). personal ⇒ ruler/heir (+ warChief or null);
  // institutional ⇒ institutionLabel, no people.
  governance: "personal" | "institutional";
  institutionLabel?: string;
  ruler?: RulerView;
  heir?: HeirView;
  warChief?: RulerView | null;
  rivals: FactionRefView[];
  allies: FactionRefView[];
};

export type DiplomacyResponse = { factions: FactionView[] };

// --- The Oligarchy Chamber (Politics Prompt 1) -------------------------------

export type SeatParty = "palaioi" | "dynatoi" | "independent";

export type ChamberSeat = {
  seatIndex: number;
  holderType: "npc" | "player" | "empty";
  // NPC seats by npc_party; player seats by the holder's CURRENT party
  // (independent-grey when party is 'none'); null for empty seats.
  party: SeatParty | null;
  holderName: string | null;
  // The player character holding this seat (its public-profile key); null for NPC
  // and empty seats. Lets the hemicycle open a held seat's public profile.
  characterId: string | null;
};

export type ChamberView = {
  capacity: number;
  seatPrice: number;
  seats: ChamberSeat[];
  composition: {
    npc: Record<SeatParty, number>;
    players: Record<SeatParty, number>;
    playersTotal: number;
    empty: number;
  };
  you: { holdsSeat: boolean; seatIndex: number | null; canBuy: boolean; reason: string | null };
};

// --- Player→player interactions (Interaction Pipeline, Prompt 1) -------------

// A public character profile — public facts only (no raw sheet; standings stay
// rank-only by design, so prestige is the one stat shown as a public signal).
export type PublicProfileView = {
  characterId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  classId: string;
  party: string;
  seatIndex: number | null;
  prestige: number;
  isAlive: boolean;
  // Server-computed: this profile is the viewer's own character (hides interactions).
  isSelf: boolean;
  viewer: {
    isOligarch: boolean;
    canInteract: boolean;
    // Present when the viewer may NOT interact (give); drives the disabled-button hint.
    lockReason: string | null;
    // The poison action (Prompt 2): whether it's available + the visible-but-locked hint.
    canPoison: boolean;
    poisonLockReason: string | null;
    // The assassinate action (Prompt 3): whether it's available + the locked hint + cost.
    canAssassinate: boolean;
    assassinateLockReason: string | null;
    assassinateCost: number;
  };
};

export type PoisonOutcome = "ill" | "dead" | "failed";
export type AssassinateOutcome = "dead" | "failed";

// PUBLIC by design — the chamber's political ledger names every voter.
export type ChamberPublicBallot = {
  voterName: string;
  party: SeatParty;
  choice: "yes" | "no";
  castAt: string;
};

export type ChamberVoteView = {
  id: string;
  gameYear: number;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  status: "open" | "passed" | "failed";
  yesCount: number | null;
  noCount: number | null;
  ballots: ChamberPublicBallot[];
};

export type ChamberVotesView = {
  open: (ChamberVoteView & { yourBallot: "yes" | "no" | null; youMayVote: boolean }) | null;
  past: ChamberVoteView[];
};

// --- Annual festivals (Prompt 7) -------------------------------------------

// A festival is a free civic event (not a daily decision); its choices carry the
// same previewed effects (costs + composure) as the decision cards.
export type FestivalLive = {
  festivalId: string;
  gameYear: number;
  event: { id: string; scene: string; choices: EventChoicePreview[] };
};

// --- The Olympiad (Prompt 8) -----------------------------------------------

// The live Olympic event (nominate or the Games) — surfaced like a festival.
export type OlympicLiveEvent = {
  festivalId: string;
  eventId: string;
  gameYear: number;
  event: { id: string; scene: string; choices: EventChoicePreview[] };
};

export type OlympiadStatus = {
  gameYear: number;
  phase: "nomination" | "voting" | "resolved" | "completed";
  nominationEndsAt: string | null;
  votingEndsAt: string | null;
  youAreCandidate: boolean;
  youAreDelegate: boolean;
  youAreOlympionikes: boolean;
  yourVote: string | null;
  ballotCount: number;
  liveEvent: OlympicLiveEvent | null;
  // The city-wide victor announcement (every client sees it via me/state).
  champion: { name: string } | null;
};

// One candidate on the voting ballot (live standings stay HIDDEN until close).
export type BallotCandidate = {
  characterId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  classId: string;
  prestige: number;
  nominatedAt: string;
};

export type OlympiadBallot = {
  gameYear: number | null;
  phase: "nomination" | "voting" | "resolved" | "completed" | null;
  votingEndsAt: string | null;
  seats: number;
  candidates: BallotCandidate[];
  yourVote: string | null;
};

export type OlympicResolution = EventResolution & {
  nominated?: boolean;
  compete?: { won: boolean; prestigeAward: number; mode: string } | null;
};

// --- Manumission (the slave's path out) ------------------------------------

export type StatBonus = Partial<{ prestige: number; devotion: number; militia: number; intelligence: number }>;

export type ManumissionChoice = {
  classId: string;
  name: string;
  flavor: string;
  bonus: StatBonus;
};

export type ManumissionOptions = {
  eligible: boolean;
  choices: ManumissionChoice[];
};

export type ManumitResult = {
  ok: true;
  classId: string;
  className: string;
  bonus: StatBonus;
};

// --- Death, succession & regency (Prompt C) --------------------------------

export type RegentBadge = {
  isRegent: true;
  wardName: string;
  wardComingOfAgeInYears: number;
  barredOffices: string[];
  keepsInTrust: string[];
};

export type SuccessionState = {
  pending: true;
  epitaph: { name: string; age: number; lifeStage: string; ladderTrait: string | null };
  // How they died; assassinated/poison drive the murder card variant. Null (legacy
  // rows, natural, mercenary) keeps the plain card.
  cause: DeathCause | null;
  plan: { kind: "blood" | "adopted" | "regency" | "fresh" | "forced_adoption" };
  heir: { name: string; relation: string } | null;
  candidates: { id: string; name: string; sex: string; age: number; houseSlug: string }[];
};

export type DynastyInfo = {
  name: string;
  generation: number;
  history: { kind: string; fromName: string | null; fromAge: number | null; toName: string | null; at: string }[];
};

// --- Family (marriage & candidate pool) ------------------------------------

export type FamilyStats = { prestige: number; devotion: number; militia: number; intelligence: number };

export type FamilyCandidate = {
  id: string;
  name: string;
  sex: string;
  houseSlug: string;
  houseName: string;
  age: number;
  ideology: number;
  stats: FamilyStats;
  trait: { id: string; name: string; description: string } | null;
  // Wife personality (from traits.json): shown where her stat row used to be.
  // Null for adoption candidates and legacy/pre-pack wives (no line rendered).
  personality: { id: string; name: string; description: string } | null;
  dowry: number;
  // Her age-stage portrait path (null until art resolves); ages with her.
  portrait: string | null;
};

export type MarriageCandidate = FamilyCandidate & {
  // Cross-house penalty preview: how marrying shifts the player + costs party favor.
  penalty: { ideologyShift: number; partyFavorLoss: number };
  party: string;
  // The exact retinue she brings on marriage (servants + household goods), derived
  // from her id — shown here is exactly what the marriage grants.
  package: { slaves: number; wool: number; oliveoil: number };
};

export type FamilyChild = {
  id: string;
  name: string;
  sex: string;
  age: number;
  portrait: string;
  comingOfAge: number;
  yearsToComingOfAge: number;
  heirEligible: boolean;
  named: boolean;
};

// The pending birth notice (newest still-unnamed child). motherDied carries grief.
export type BirthEvent = {
  childId: string;
  childName: string;
  sex: string;
  motherDied: boolean;
  lateWifeName: string | null;
};

// The current spouse: a candidate plus her lazily-aged current age (in `age`)
// and a quiet fertility hint.
export type SpouseView = FamilyCandidate & {
  fertile: boolean;
  // True once she is past the childbearing window — a quiet note, nothing loud.
  pastChildbearing: boolean;
  // The philia bond (0–100) + its band name. Null only if no marriage row exists
  // (→ the client renders no bar rather than a broken one).
  philia: number | null;
  philiaBand: string | null;
  // Action availability, computed server-side (so the client never re-derives the
  // game-year math): a gift is +1 this year (diminished); a symposium is spent.
  giftDiminished: boolean;
  symposiumAvailable: boolean;
  loverState: string; // 'none' | 'active' | 'fallen'
  // Voluntary divorce is gated until the marriage is a game year old; the reason
  // string is null when available (server is the single source of truth).
  divorceAvailable: boolean;
  divorceBlockedReason: string | null;
};

// A spouse-death-of-old-age notice (surfaces for one season, then auto-clears).
export type SpouseDeathNotice = {
  lateWifeName: string | null;
  yearsMarried: number;
};

// A divorce-aftermath notice (surfaces for one season on the ended marriage).
export type DivorceNotice = {
  formerWifeName: string | null;
  yearsMarried: number;
};

// A tragedy-aftermath notice (one season). `archetype` is 'phaedra' |
// 'clytemnestra' (the survived attempt) | 'medea' — the web picks the copy. A
// Clytemnestra success never surfaces here (the marriage is the dead predecessor's).
export type TragedyNotice = {
  archetype: string;
  formerWifeName: string | null;
  yearsMarried: number;
};

export type FamilyState = {
  sex: string;
  classId: string;
  married: boolean;
  // slave -> locked (whole panel); hetaira -> marriage:false (adoption only).
  locks: { locked: boolean; marriage: boolean; adoption: boolean };
  characterIdeology: number;
  spouse: SpouseView | null;
  spouseDeath: SpouseDeathNotice | null;
  // Lover-plot + divorce notices, derived server-side for one season each.
  divorceNotice: DivorceNotice | null;
  // A tragedy aftermath (Phaedra / Clytemnestra-failure / Medea), one season.
  tragedyNotice: TragedyNotice | null;
  fellNotice: boolean;
  discoveredNotice: boolean;
  // The succession outlook ("If you fell today, …"), the Adopt-button visibility,
  // a one-season adoption notice, and the honest pending-item count for the badge.
  // The succession outlook. passedOverSon names the eldest of-age son the adopted
  // heir is preferred over ("…over your son <Son>"), non-null only for that case.
  successionOutlook: { kind: string; heirName: string | null; passedOverSon: string | null };
  // The designated heir after in-life adoption: the full candidate card he was
  // adopted from (portrait, stats, trait), his age frozen at adoption. Null until adopted.
  adoptedHeir: FamilyCandidate | null;
  // The standing heir preference ('blood' | 'adopted'); marks the active choice on
  // the prompt and the toggle. Consulted only when both an of-age son and heir exist.
  heirPreference: string;
  // The come-of-age prompt: a son first reaches manhood while an adopted heir stands.
  // Derived for one season; its inline choices post the preference. Null otherwise.
  heirChoiceNotice: { son: string; heir: string; preference: string } | null;
  showAdoption: boolean;
  adoptionNotice: { name: string; house: string } | null;
  pendingCount: number;
  candidates: { marriage: MarriageCandidate[]; adoption: FamilyCandidate[] };
  children: FamilyChild[];
  birthEvent: BirthEvent | null;
  // Prompt C: the dynasty header/history, the regent badge, and a pending succession.
  dynasty?: DynastyInfo | null;
  regent?: RegentBadge | null;
  succession?: SuccessionState | null;
};

export type MarryResult = {
  ok: true;
  spouseName: string;
  dowry: number;
  ideologyShift: number;
  partyFavorLoss: number;
  party: string;
};

// URL for an image the API refers to by web-origin path (portraits under
// /portraits/, story art under /stories/). Those files ship with the web build
// (apps/web/public), so the path is used as-is on the page's own origin.
export function webAssetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("/") ? path : `/${path}`;
}

// Same-origin URL for a portrait named by an age-config path ("avatars/<file>").
export function portraitUrl(configPath: string | null | undefined): string | undefined {
  const file = configPath?.split("/").pop();
  return file ? `/portraits/${file}` : undefined;
}

// --- Daily Routines (proactive half of the daily loop) ---------------------

export type RoutineRequirementView = {
  // `keep`: needed in stock, not spent (drawn as "Needs", not "−").
  good?: { type: string; qty: number; keep?: boolean };
  fee?: number;
  waivedBy?: string;
  // True when the player owns the waivedBy building (cost is zeroed).
  waived: boolean;
};

export type RoutineCardView = {
  id: string;
  label: string;
  scene: string;
  tags: string[];
  feedsLadder: string | null;
  // Per-character resolved preview (effects after classMods + growthMultiplier).
  costs: ChoiceCost[];
  composureDelta: number;
  composureReason: string;
  // Routine consumption hook: the good/fee the card consumes + waiver state.
  requires: RoutineRequirementView | null;
};

export type RoutineLadder = {
  xp: number;
  nextThreshold: number | null;
  stat: string;
  tiers: { xp: number; trait: string }[];
};

export type RoutineSet = {
  pool: string;
  dailyPicks: number;
  withdrawn: boolean;
  // The routine already chosen today, if any (one pick/day).
  pickedRoutineId: string | null;
  cards: RoutineCardView[];
  ladders: Record<string, RoutineLadder>;
};

export type RoutineResult = {
  ok: true;
  routineId: string;
  label: string;
  repeated: boolean;
  costs: ChoiceCost[];
  composureDelta: number;
  composureReason: string;
  composure: number;
  broke: boolean;
  grantedTrait: string | null;
  ladder: { id: string; newXp: number; nextThreshold: number | null; traitGranted: string | null } | null;
  // True when a required cost was waived because the player owns the building.
  waived: boolean;
};

// --- The Ledger / player economy (Economy Build 1) --------------------------

export type BuildingCategory = "agricultural" | "yearround";

export type CatalogTier = {
  tier: number;
  name?: string;
  rank?: string;
  cost: number;
  buildDays: number;
  upkeep: number;
  income: number;
  yields: { good: string; perDay: number }[];
  materials: Record<string, number>;
  staffing: Partial<Record<PopType, number>>;
};

export type PopType = "slave" | "freeman" | "citizen" | "physician" | "bodyguard" | "spymaster";
export type CraftRecipe = { building: string; tier: number; recipe: Record<string, number> };

export type CatalogEntry = {
  id: string;
  kind: "class" | "common";
  name: string;
  icon?: string;
  category: BuildingCategory;
  blurb?: string;
  storageBonus?: number;
  composurePerDay?: number;
  // Withheld from the buildable list; an already-owned instance still renders.
  hidden?: boolean;
  tiers: CatalogTier[];
};

export type VendorPrice = { good: string; buy: number; sell: number };

// GET /api/market — mirrors services/market.ts (MarketView) by hand. Listings come
// sorted by good, then price, then age; `mine` marks the viewer's own stalls.
export type MarketListing = {
  id: string;
  good: string;
  remaining: number;
  price: number;
  createdAt: string;
  mine: boolean;
  seller: { playerId: string; name: string; houseSlug: string; houseName: string; professionSlug: string | null; faceId: string | null; portrait: string | null };
};
export type MarketView = { listings: MarketListing[]; open: number; cap: number; taxExempt: boolean };
export type MarketListResult = { ok: true; listing: { id: string; good: string; remaining: number; price: number; createdAt: string }; balance: number };
export type MarketBuyResult = { ok: true; qty: number; total: number; tax: number; wallet: number; balance: number; remaining: number };
export type MarketCancelResult = { ok: true; returned: number; balance: number };

// GET /api/koinon — mirrors services/koinon.ts (KoinonView) by hand. `invites`
// is the caller's own and empty for a member; `koinon` is null for a non-member;
// `pending` is filled for the leader and the vice only.
export type KoinonRole = "leader" | "vice" | "member";
export type KoinonMember = {
  playerId: string;
  name: string;
  houseSlug: string;
  houseName: string;
  professionSlug: string | null;
  faceId: string | null;
  portrait: string | null;
  party: string;
  joinedLabel: string;
  role: KoinonRole;
};
export type KoinonPage = {
  now: string;
  rules: {
    foundCost: number;
    foundPrestige: number;
    memberCap: number;
    nameMin: number;
    nameMax: number;
    postMaxChars: number;
    cooldownHours: number;
    absentLeaderDays: number;
    // Koinon prompt 2: the most one gift may be, and the Lesche's numbers.
    depositMax: number;
    lescheCost: number;
    lescheBuildDays: number;
    lescheUpkeep: number;
    lescheCap: number;
    // Koinon prompt 3: the bounds of a muster's lead.
    musterMinLeadMinutes: number;
    musterMaxLeadHours: number;
  };
  me: { playerId: string; role: KoinonRole | null; cooldownUntil: string | null; prestige: number; drachmae: number };
  koina: { id: string; name: string; leaderName: string; members: number; cap: number }[];
  invites: { id: string; koinonId: string; koinonName: string; inviterName: string; expiresAt: string }[];
  koinon: null | {
    id: string;
    name: string;
    foundedLabel: string;
    cap: number;
    leaderPlayerId: string | null;
    vicePlayerId: string | null;
    leaderAbsent: boolean;
    canTakeLead: boolean;
    members: KoinonMember[];
    pending: { id: string; playerName: string; expiresAt: string }[];
    posts: { id: string; authorName: string; body: string; label: string; canDelete: boolean }[];
    unread: number;
    // The treasury, the Lesche as it stands at `now`, every giver's total and
    // the 10 newest gifts. `daysCovered` counts for an open hall only.
    treasury: number;
    hall: { phase: KoinonHallPhase; startedAt: string | null; completesAt: string | null; paidUntil: string | null; daysCovered: number };
    givers: { playerId: string; name: string; total: number }[];
    gifts: { id: string; name: string; amount: number; label: string }[];
    // Koinon prompt 3: the open Raid muster and the most recent closed one.
    muster: KoinonMuster | null;
    lastMuster: KoinonLastMuster | null;
  };
};
export type KoinonHallPhase = "none" | "building" | "open" | "shut";
// The open muster: mirrors services/koinonMuster.ts (MusterView). `outlook` is
// the launch verdict as the pledges stand: `space` is the room the men need,
// `hullSpace` the seats on the hulls that can make the crossing (0 by land).
export type KoinonMuster = {
  id: string;
  kind: "raid";
  openerName: string;
  canCancel: boolean;
  target: { regionId: string; townId: string | null; name: string };
  gather: { id: string; name: string };
  openedLabel: string;
  launchAt: string;
  pledges: { playerId: string; name: string; men: number; space: number; pentekonters: number; triremes: number }[];
  outlook: { route: "land" | "sea" | null; steps: number | null; ok: boolean; reason: string | null; space: number; hullSpace: number };
};
// One member's part in a marched muster, and the report every member sees.
// `spoil` is the member's part of the plunder's third good; a report stored before the raids prompt has none.
export type KoinonMusterPart = { playerId: string; name: string; men: number; lost: number; hulls: number; seats: number; shares: number; drachmae: number; grain: number; spoil?: number };
export type KoinonMusterReport = {
  outcome: "won" | "driven_off" | "repulsed" | "stood_down";
  reason: string | null;
  line: string | null;
  men: number;
  lost: number;
  killed: number;
  plunder: { drachmae: number; grain: number; spoil?: { good: string; label: string; amount: number } } | null;
  // The nation the raid soured, if any; a report stored before the raids prompts has none.
  opinion?: { factionId: string; name: string; from: number; to: number; line: string } | null;
  parts: KoinonMusterPart[];
};
export type KoinonLastMuster = { id: string; targetName: string; gatherName: string; launchLabel: string; status: "resolved" | "stood_down" | "cancelled"; reason: string | null; report: KoinonMusterReport | null };
// GET /api/koinon/muster/targets: the gathering places, the targets reachable in
// principle from the chosen one, and the Winter a launch chosen now could land in.
export type KoinonMusterTargets = {
  now: string;
  winter: { from: string; until: string } | null;
  gathers: { id: string; name: string }[];
  gatherId: string;
  targets: { regionId: string; townId: string | null; name: string; kind: "town" | "region"; route: "land" | "sea"; steps: number }[];
};
// GET /api/koinon/muster/mine: the caller's rows at the gathering place and his hulls.
export type KoinonMusterMine = {
  now: string;
  gather: { id: string; name: string };
  rows: { rowId: string; unitId: string; label: string; plural: string; icon: string; source: "trained" | "band"; count: number; pledged: boolean }[];
  ships: { id: string; label: string; inStock: number; pledged: number; range: number; troopSpace: number }[];
};
// GET /api/koinon/armies — leader only; mirrors ArmiesView. Read-only and derived
// at read time. `return` is a party on its way back (from targetName, when named).
export type KoinonArmyRow = { unitId: string; label: string; plural: string; icon: string; source: "trained" | "band"; count: number };
export type KoinonMissionKind = "scout" | "raid" | "attack" | "move" | "return";
export type KoinonArmies = {
  now: string;
  members: {
    playerId: string;
    name: string;
    levy: number;
    fleet: { pentekonters: number; triremes: number };
    home: { placeId: string; placeName: string; rows: KoinonArmyRow[] }[];
    away: (KoinonArmyRow & { missionKind: KoinonMissionKind; targetName: string | null; arrivesAt: string })[];
    training: (KoinonArmyRow & { readyAt: string | null })[];
  }[];
};

export type BuildingsCatalog = {
  season: string;
  seasonMultiplier: { agricultural: number; yearround: number };
  classBuilding: CatalogEntry | null;
  commons: CatalogEntry[];
  classSectionLabel: string | null;
  vendor: VendorPrice[];
  goodLabels: Record<string, string>;
  craft: Record<string, CraftRecipe>;
};

export type OwnedBuilding = {
  id: string;
  kind: "class" | "common";
  name: string;
  icon?: string;
  tier: number;
  status: "constructing" | "active";
  completesAt: string | null;
  startedAt: string | null;
  category: BuildingCategory;
  yields: { good: string; perDay: number; pending: number }[];
  income: number;
  pendingIncome: number;
  upkeepPerDay: number;
  idle: boolean;
  upgrade: { tier: number; name?: string; cost: number; buildDays: number; newYields: { good: string; perDay: number }[] } | null;
};

// The class-section slot — built for the hard case (the hoplite's stateful,
// time-bound, stat-gated contracts), empty for the landowner and every class now.
export type ClassActionEntry = {
  id: string;
  title: string;
  detail: string;
  status: "available" | "active" | "locked" | "complete";
  startedAt?: string | null;
  expiresAt?: string | null;
  requiresStat?: { stat: string; min: number };
  requiresRank?: string;
  rewards?: { label: string }[];
  costs?: { label: string }[];
};

export type ClassSection = {
  label: string | null;
  comingSoon: boolean;
  flavor?: string;
  entries: ClassActionEntry[];
};

export type BuildingsMine = {
  now: string; // server time (ISO); countdowns anchor to this, not the device clock
  season: string;
  buildings: OwnedBuilding[];
  pendingIncomeTotal: number;
  upkeepOwed: number;
  pendingGoods: Record<string, number>;
  storageCap: number;
  classSection: ClassSection;
  pops: Record<string, number>;
  // The army's daily draw by good, `drachmae` for band pay — the Barracks strip's
  // figures, carried here so the Economy view lists them without a second fetch.
  army: { perDay: Record<string, number> };
};

// The retained spymaster's posture + remaining switch cooldown (Prompt 4). Additive
// on the People payload — the toggle shows only when a spymaster is owned (mine.pops).
export type SpymasterStatus = { posture: "guard" | "hunt"; cooldownRemainingMs: number };

export type PeopleView = {
  foodGood: string;
  pops: { type: PopType; label: string; dismissLabel: string; hireCost: number; sellBack: number; upkeepPerDay: number; foodPerDay: number; civic: boolean }[];
  spymaster: SpymasterStatus;
};

export type HireResult = { ok: true; popType: string; hired: number; unitCost: number; total: number; wallet: number; owned: number };
export type DismissResult = { ok: true; popType: string; dismissed: number; owned: number };
export type CraftResult = { ok: true; good: string; consumed: Record<string, number>; balance: number };

export type VendorResult = {
  ok: true;
  action: "buy" | "sell";
  type: string;
  qty: number;
  unitPrice: number;
  total: number;
  wallet: number;
  balance: number;
};

export type CollectResult = {
  banked: Record<string, number>;
  income: number;
  upkeep: number;
  staffUpkeep: number;
  foodDrawn: number;
  foodBought: number;
  foodCost: number;
  collected: number;
  owed: number;
  composure: number;
  idled: string[];
};

// --- The hoplite's home army: ranks + salary (Hoplite Step 1) ---------------

export type ServiceRankView = { id: string; name: string; rank?: string; salaryPerDay: number; militiaPerDay: number };
export type ServiceNextRank = ServiceRankView & { gate: { militia: number; prestige: number } };

export type ServiceView = {
  isHoplite: boolean;
  rankId: "none" | "recruit" | "veteran" | "lochagos" | "archilochagos";
  rank: ServiceRankView | null;
  next: ServiceNextRank | null;
  // Whether the player clears `next`'s gate (drives the Enlist/Promote button).
  qualifies: boolean;
  shortfall: { militia: number; prestige: number } | null;
  accrued: { drachmae: number; militia: number };
  salaryPerDay: number;
  stats: { militia: number; prestige: number };
  // True while sworn to a mercenary contract — home rank salary is paused.
  abroad: boolean;
  // Re-class (Step 5): the "leave soldiering" option — available, never prompted.
  reclass: {
    eligible: boolean;
    reason: "wound" | "retirement" | null;
    targets: { classId: string; name: string; flavor: string }[];
  };
};

export type ServiceActionResult = { ok: true; collected?: { drachmae: number; militia: number }; status: ServiceView };
export type ReclassResult = { ok: true; from: string; to: string; reason: "wound" | "retirement" };

// --- Mercenary contracts: hiring board + go/return lifecycle (Hoplite Step 2) ---

export type RiskOutcome = "clean" | "scare" | "injury" | "death";

export type ContractBoardEntry = {
  id: string;
  name: string;
  gate: { militia: number; prestige: number };
  dailyDrachmae: number;
  termSeasons: number;
  minCancelSeasons: number;
  poolKey: string;
  qualifies: boolean;
  shortfall: { militia: number; prestige: number };
  hard: boolean;
  woundBarred: boolean;
};

export type JustReturned = { outcome: RiskOutcome; awardedTraits: string[]; died: boolean; composureHit: number };

export type CurrentContractView = {
  id: string;
  name: string;
  poolKey: string;
  dailyDrachmae: number;
  seasonsElapsed: number;
  seasonsTotal: number;
  accrued: number;
  canCancel: boolean;
  earliestCancelSeason: number;
};

export type MercBoard = {
  isHoplite: boolean;
  abroad: boolean;
  holdsStrategos: boolean;
  wounded: boolean;
  stats: { militia: number; prestige: number };
  contracts: ContractBoardEntry[];
  current: CurrentContractView | null;
  justReturned: JustReturned | null;
};

export type MercActionResult = { ok: true; collected?: number; completed?: boolean; awardedTraits?: string[]; outcome?: RiskOutcome | null; died?: boolean; board: MercBoard };

export type DailyCard = {
  arena: string;
  resolved: boolean;
  resolvedChoiceId: string | null;
  resolvedResult: string | null;
  event: GameEvent;
};

export type DailySet = {
  withdrawn: boolean;
  remaining: number;
  cards: DailyCard[];
};

export type ChoiceCost = {
  label: string;
  tone: "positive" | "negative" | "neutral";
};

export type EventChoicePreview = {
  id: string;
  label: string;
  resultText: string;
  tags?: string[];
  // Precomputed composure cost/gain for the current character (preview).
  composureDelta: number;
  composureReason: string;
  // Up-front mechanical effects (stats, drachmae, favor, ideology, resources).
  costs: ChoiceCost[];
};

export type GameEvent = {
  id: string;
  scene: string;
  choices: EventChoicePreview[];
};

export type EventResolution = {
  resultText: string;
  composureDelta: number;
  composureReason: string;
  composure: number;
  broke: boolean;
  grantedTrait: string | null;
};

// --- Barracks (GET /api/barracks; mirrors apps/server/src/services/barracks.ts) ---

// Met for every free character; the unfree see the Barracks locked with `reason` (barracks prompt 4).
export type BarracksGate = { met: boolean; reason: string | null };

export type BarracksUnit = {
  id: string;
  label: string;
  plural: string; // "Peltasts", "Ekdromoi"
  icon: string;
  role: string;
  trainSeasons: number;
  gear: Record<string, number>;
  upkeepPerDay: Record<string, number>;
  stats: Record<string, number>;
};

export type BarracksRosterRow = {
  id: string;
  source: "trained" | "band";
  unitId: string;
  label: string;
  plural: string; // the unit's plural from content; a band's label (already plural)
  icon: string;
  count: number;
  startCount: number;
  recruitedSeason: number;
  readyAt: string | null; // ISO; trained only — the instant training completes
  contractEndAt: string | null; // ISO; band only — the instant the contract ends
  basedAt: string; // region id the row stands in
  movingTo: string | null; // region id of a relocation or recovery in flight
  arrivesAt: string | null; // ISO; when that movement completes
  // What a moving row is doing (townId when the target or destination is a town).
  // A standing row whose kind is "muster" is pledged to its koinon's muster.
  // `marchId`: a party on its way out to a scout, raid or attack carries its march; the way home carries none.
  mission: { kind: "scout" | "raid" | "attack" | "move" | "muster"; regionId: string; townId?: string; musterId?: string; marchId?: string; departedAt: string } | null;
  createdAt: string; // ISO; training progress runs from here to readyAt
  stats: Record<string, number>; // the unit's or band's stat block (for the force picker)
  active: boolean;
  canDisband: boolean;
};

export type BarracksOffer = {
  id: string;
  label: string;
  icon: string;
  role: string;
  men: number;
  upkeepPerDay: Record<string, number>;
  stats: Record<string, number>;
  hired: boolean;
};

// A battle report (raids prompt 4; mirrors MarchReportView in services/barracks.ts): kept on its
// march, listed newest first, unread until its owner first opens it.
export type BarracksReport = { id: string; kind: MapActType; regionId: string; townId: string | null; arrivedAt: string; gameDate: string; seen: boolean; report: MapActReport };
// Hulls at sea (raids prompt 3): one entry per sailing, listed under Away · Returning.
export type BarracksVoyage = { id: string; ships: { id: string; label: string; count: number }[]; kind: "scout" | "raid" | "attack" | "move"; musterId: string | null; regionId: string; townId: string | null; sailedAt: string; returnsAt: string };
export type BarracksView = {
  gate: BarracksGate;
  // Display names for every place the roster mentions (bases, destinations, mission targets): region ids and town slugs alike.
  places: Record<string, string>;
  season: number;
  now: string; // server time (ISO); countdowns anchor to this, not the device clock
  levy: { men: number };
  // config.altar: the blessing's length in seasons and the morale bonus per good (one button each).
  config: { minServiceSeasons: number; maxActiveBands: number; termSeasons: number; altar: { seasons: number; goods: Record<string, number> } };
  units: BarracksUnit[];
  roster: BarracksRosterRow[];
  offers: BarracksOffer[];
  activeBands: number;
  // The army's upkeep per day (zero-valued goods omitted) and each active row's
  // own line; a row still training has no entry.
  upkeep: { perDay: Record<string, number>; rows: Record<string, Record<string, number>>; note: string };
  // The summary strip: men under arms (trained rows in every state) against the levy at home.
  // growthPerYear is the total at the next year boundary: the content growth plus what held, garrisoned regions add.
  summary: { underArms: number; levyMen: number; growthPerYear: number; baseGrowthPerYear?: number; heldRegions?: number; seasonsPerYear: number };
  // The ships in stock for the strip's FLEET cell: labels from ships.json, troop space summed, range the farthest hull.
  fleet: { ships: { id: string; label: string; role: "transport" | "warship"; count: number; troopSpace: number; range: number; naval: number }[]; space: number; range: number };
  // The hulls at sea, one entry per sailing (optional: an older payload has none).
  atSea?: BarracksVoyage[];
  // The battle reports, newest first, the latest ten (optional: an older payload has none).
  reports?: BarracksReport[];
  // The altar while lit (the good burned, its morale bonus, the instant it goes cold), else null.
  altar: { good: string; mor: number; until: string } | null;
};

// --- Map reach (GET /api/map/reach; mirrors packages/shared/src/reach.ts) ---

export type ReachVerdict = { ok: boolean; reason?: string };

export type ReachEntry = {
  landSteps: number | null; // shortest land distance from any base, null if > 2
  seaSteps: number | null; // fewest seas from any base's coast, null if none
  byBase: Record<string, { landSteps: number | null; seaSteps: number | null }>; // the same from each base alone
  attack: ReachVerdict;
  raid: ReachVerdict;
  colonise: ReachVerdict;
};

// A base: `id` is what rows are based at (a region id, or a town slug for a held
// town or a home town), `regionId` the region it stands in. A holding carries what
// it pays: the men standing there against the minimum its tribute needs, the
// tribute a day, and the levy it adds a year (regions only).
export type BaseKind = "massalia" | "colony" | "conquest" | "home";
export type HoldingView = { garrison: number; minGarrison: number; perDay: { drachmae: number; grain: number; timber: number }; levyPerYear: number };
export type BaseView = { id: string; regionId: string; townId: string | null; kind: BaseKind; name: string; holding: HoldingView | null };
// A place the player may move men to, with the steps from each base (by base id).
export type MoveTargetView = { id: string; regionId: string; townId: string | null; kind: BaseKind; name: string; byBase: Record<string, { landSteps: number | null; seaSteps: number | null }> };
export type FleetHull = { id: string; label: string; role: "transport" | "warship"; count: number; troopSpace: number; range: number; naval: number };
export type FleetView = { ships: Record<string, number>; labels?: Record<string, string>; range: number; space: number; tiers?: { range: number; space: number }[]; hulls?: FleetHull[] };

export type MapReachView = {
  now: string; // server time (ISO); countdowns anchor to this, not the device clock
  campaign: { season: string; open: boolean; opensAt: string | null }; // closed in Winter
  bases: BaseView[];
  force: { men: number; space: number };
  fleet: FleetView;
  // Keyed by region id; a region absent here keeps the legality matrix's own verdict.
  reach: Record<string, ReachEntry>;
  moveTargets: MoveTargetView[];
};

// --- Map actions (POST /api/map/act; mirrors apps/server/src/services/mapActions.ts) ---

export type MapActType = "scout" | "raid" | "attack";

export type MapActReport = {
  type: MapActType;
  regionId: string;
  regionName: string;
  // Set when the target is a town: the town, its survey and the effective def its garrison fought at.
  townId: string | null;
  townName: string | null;
  town: { walls: number; population: number; garrisonDef: number } | null;
  // Set for a sea assault on a town: the fleet that sailed, both sides' naval power and whether the landing held.
  fleet: { ships: Record<string, number>; naval: number; defender: { pentekonters: number; triremes: number; naval: number }; held: boolean } | null;
  base: string;
  route: "land" | "sea";
  steps: number;
  // The march (raids prompt 4): its id, the road's minutes each way, the instant the party
  // reached the place, and when the survivors are home (null after a conquest, and when nobody comes back).
  marchId: string;
  minutes: number;
  arrivedAt: string;
  homeAt: string | null;
  destination: string;
  ships: Record<string, number>;
  shipLabels?: Record<string, string>; // display names from ships.json by ship id
  // "turned_back": the place was its own house's, or another house's for an attack, when the party
  // arrived; "dispersed": its men all left the roster on the road. Neither fought.
  winner: "attacker" | "defender" | "stand" | "repulsed" | "turned_back" | "dispersed" | null;
  rounds: number;
  attacker: { rows: { id: string; unitId: string; label: string; icon: string; start: number; end: number; broke: boolean }[]; losses: number };
  // `turnout`: the men who fought (a fifth of the pool for a raid). Optional, as is the plunder's
  // third good: a report stored before the raids prompt has neither.
  defender: { label: string; start: number; end: number; losses: number; turnout?: number } | null;
  plunder: { drachmae: number; grain: number; spoil?: { good: string; label: string; amount: number } } | null;
  conquest: { regionId: string; townId: string | null; previousOwner: string | null } | null;
  intel: { warband: number; pentekonters?: number; triremes?: number; scoutedGameDate: string } | null;
  // The nation a raid soured, if any; a report stored before the raids prompts has none.
  opinion?: { factionId: string; name: string; from: number; to: number; line: string } | null;
  line: string;
};

// The set-out card (mirrors MapSetOutReport in mapActions.ts): the party is on the road; `ships` is every hull that sailed.
export type MapSetOutReport = {
  type: "setout";
  action: MapActType;
  marchId: string;
  regionId: string;
  regionName: string;
  townId: string | null;
  townName: string | null;
  base: string;
  route: "land" | "sea";
  steps: number;
  minutes: number;
  departedAt: string;
  arrivesAt: string;
  ships: Record<string, number>;
  shipLabels?: Record<string, string>;
  men: number;
  rows: { id: string; unitId: string; label: string; icon: string; count: number }[];
  line: string;
};

// A move's report (mirrors MapMoveReport in mapActions.ts): one line, the march.
export type MapMoveReport = {
  type: "move";
  from: string;
  fromName: string;
  baseId: string;
  regionId: string;
  regionName: string;
  townId: string | null;
  townName: string | null;
  route: "within" | "land" | "sea";
  steps: number;
  minutes: number;
  arrivesAt: string;
  ships: Record<string, number>;
  shipLabels?: Record<string, string>;
  men: number;
  rows: { id: string; unitId: string; label: string; icon: string; count: number }[];
  line: string;
};

export type MapActResponse<R = MapActReport> = {
  report: R;
  reach: MapReachView;
  force: MapReachView["force"];
  fleet: MapReachView["fleet"];
  roster: BarracksRosterRow[];
};
// A target for an action: a townless region or a town.
export type MapActTarget = { regionId: string } | { townId: string };
