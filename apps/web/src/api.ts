const configuredApiUrl = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error("VITE_API_URL is required for production builds. Refusing to use a localhost API URL.");
}

export const apiBaseUrl = (configuredApiUrl ?? (import.meta.env.DEV ? "http://localhost:3001" : "")).replace(/\/$/, "");

import type { AgeConfig, CharacterSheet, GameDate } from "@massalia/shared";

export type { CharacterSheet } from "@massalia/shared";
export type { AgeConfig } from "@massalia/shared";

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

// Session token storage. We still send cookies (credentials: "include") for
// same-site/cookie-friendly browsers, but cross-site cookies are blocked on iOS
// Safari, so we also keep the token here and send it as an Authorization header.
const TOKEN_STORAGE_KEY = "massalia_session_token";

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null) {
  try {
    if (token) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable (private mode); cookie path still applies.
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
      return context === "creation"
        ? "That email is already registered. Log in with it, then return to character creation."
        : "That email is already registered. Try logging in instead.";
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
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
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
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data as T;
}

export type AuthResponse = {
  user: { id: string; email: string } | null;
  hasCharacter: boolean;
  token?: string;
};

export type CreationRequest = {
  classSlug: string;
  houseSlug: string;
  avatarId: string;
  name: string;
};

export type PlayerState = {
  user: { id: string; email: string; newsletterOptIn: boolean };
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
  resources: {
    gold: number;
    prestige: number;
    influence: number;
    classResource: {
      type: string;
      label: string;
      amount: number;
    };
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

async function authenticate(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>(path, { method: "POST", body });
  if (result.token) {
    setStoredToken(result.token);
  }
  return result;
}

export const api = {
  register: (email: string, password: string, newsletterOptIn = false) =>
    authenticate("/auth/register", { email, password, newsletterOptIn }),
  login: (email: string, password: string) => authenticate("/auth/login", { email, password }),
  logout: async () => {
    try {
      return await apiFetch<{ ok: true }>("/auth/logout", { method: "POST" });
    } finally {
      setStoredToken(null);
    }
  },
  me: () => apiFetch<AuthResponse>("/auth/me"),
  createCharacter: (payload: CreationRequest) => apiFetch("/characters", { method: "POST", body: payload }),
  state: () => apiFetch<PlayerState>("/me/state"),
  setNewsletter: (optIn: boolean) =>
    apiFetch<{ ok: true; newsletterOptIn: boolean }>("/me/newsletter", { method: "POST", body: { optIn } }),
  joinParty: (party: "dynatoi" | "palaioi") =>
    apiFetch<{ party: string }>("/api/party/join", { method: "POST", body: { party } }),
  leaveParty: () => apiFetch<{ party: string }>("/api/party/leave", { method: "POST" }),
  character: () => apiFetch<{ character: CharacterSheet }>("/api/character"),
  events: () => apiFetch<GameEvent[]>("/api/events"),
  dailyEvents: () => apiFetch<DailySet>("/api/events/daily"),
  resolveEvent: (eventId: string, choiceId: string) =>
    apiFetch<EventResolution>(`/api/events/${eventId}/choices/${choiceId}`, { method: "POST" }),
  routines: () => apiFetch<RoutineSet>("/api/routines"),
  resolveRoutine: (routineId: string) =>
    apiFetch<RoutineResult>("/api/routines/resolve", { method: "POST", body: { routineId } }),
  // Age config (avatars + age options) — served statically; public, for signup.
  ageConfig: () => apiFetch<AgeConfig>("/content/age/age-config.json"),
  family: () => apiFetch<FamilyState>("/api/family"),
  marry: (candidateId: string) => apiFetch<MarryResult>("/api/family/marry", { method: "POST", body: { candidateId } }),
  nameChild: (childId: string, name: string) =>
    apiFetch<{ ok: boolean; name: string }>(`/api/family/children/${childId}/name`, { method: "POST", body: { name } }),
  succeed: (candidateId?: string) =>
    apiFetch<{ ok: true; heirName: string; kind: string }>("/api/family/succeed", { method: "POST", body: { candidateId } }),
  adopt: (candidateId: string) =>
    apiFetch<{ ok: true; heirName: string; endedRegency: boolean }>("/api/family/adopt", { method: "POST", body: { candidateId } }),
  resolveFestival: (festivalId: string, choiceId: string) =>
    apiFetch<EventResolution>("/api/festivals/resolve", { method: "POST", body: { festivalId, choiceId } }),
};

// --- Annual festivals (Prompt 7) -------------------------------------------

// A festival is a free civic event (not a daily decision); its choices carry the
// same previewed effects (costs + composure) as the decision cards.
export type FestivalLive = {
  festivalId: string;
  gameYear: number;
  event: { id: string; scene: string; choices: EventChoicePreview[] };
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
  dowry: number;
};

export type MarriageCandidate = FamilyCandidate & {
  // Cross-house penalty preview: how marrying shifts the player + costs party favor.
  penalty: { ideologyShift: number; partyFavorLoss: number };
  party: string;
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

export type FamilyState = {
  sex: string;
  classId: string;
  married: boolean;
  // slave -> locked (whole panel); hetaira -> marriage:false (adoption only).
  locks: { locked: boolean; marriage: boolean; adoption: boolean };
  characterIdeology: number;
  spouse: FamilyCandidate | null;
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

// Absolute URL for a content asset path returned by the API (e.g. a portrait).
export function contentUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

// --- Daily Routines (proactive half of the daily loop) ---------------------

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
};

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
