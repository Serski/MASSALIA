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
  // The Olympiad cycle status (phase, badges, live event, city-wide victor), or null.
  olympiad: OlympiadStatus | null;
  // Manumission: { eligible } when a slave holds the freedman trait, else flag false.
  manumission: { eligible: boolean } | null;
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

// The Player Chronicle (Timeline): a dated, generation-tagged life-event, with a
// structured payload the client renders into prose (see renderChronicleEntry).
export type ChronicleType =
  | "marriage"
  | "birth"
  | "megas_choregos"
  | "festival_participation"
  | "olympic_selection";

export type ChronicleEntry = {
  seasonIndex: number;
  label: string;
  generation: number;
  type: ChronicleType;
  payload: Record<string, unknown>;
};

async function authenticate(path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  const result = await apiFetch<AuthResponse>(path, { method: "POST", body });
  if (result.token) {
    setStoredToken(result.token);
  }
  return result;
}

// --- Province/map system (map API) ------------------------------------------
export type MapPolity = { id: string; name: string; color: string };
export type MapStateProvince = {
  provinceId: string;
  type: string;
  terrain: string;
  coastal: boolean;
  ownerPolityId: string | null;
  controllerPolityId: string | null;
  sinceTick: number;
};
export type MapTown = { id: string; name: string; provinceId: string | null; polityId: string | null; lon: number; lat: number; pxX: number; pxY: number };
export type MapState = { worldId: string; tick: number; polities: MapPolity[]; provinces: MapStateProvince[]; towns: MapTown[] };
export type MapChangeType = "occupy" | "annex";
export type MapProvinceChange = {
  provinceId: string;
  ownerPolityId: string | null;
  controllerPolityId: string | null;
  sinceTick: number;
  tick: number;
  changeType: string;
};

// Subscribe to the map realtime stream. EventSource can't send the Authorization
// header (and the dev cookie is cross-site SameSite=lax, so it wouldn't flow
// either), so we consume the SSE with fetch streaming + the Bearer token instead.
// onState fires once with the initial snapshot; onChange fires per conquest.
// Returns an unsubscribe function that aborts the request.
export function streamMap(handlers: { onState?: (state: MapState) => void; onChange?: (change: MapProvinceChange) => void; onError?: (error: unknown) => void }): () => void {
  const controller = new AbortController();
  const token = getStoredToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;

  (async () => {
    const response = await fetch(`${apiBaseUrl}/api/map/stream`, { headers, credentials: "include", signal: controller.signal });
    if (!response.ok || !response.body) throw new ApiError("Map stream failed", response.status);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        const parsed = JSON.parse(data);
        if (event === "state") handlers.onState?.(parsed as MapState);
        else if (event === "change") handlers.onChange?.(parsed as MapProvinceChange);
      }
    }
  })().catch((error) => {
    if (!controller.signal.aborted) handlers.onError?.(error);
  });

  return () => controller.abort();
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
  // The Player Chronicle (Timeline): the house's dated, generation-tagged history.
  chronicle: () => apiFetch<{ entries: ChronicleEntry[] }>("/me/chronicle"),
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
  // Province/map system: full ownership state, and a conquest ('occupy' takes
  // control only; 'annex' takes owner + control). Live updates arrive via streamMap.
  mapState: () => apiFetch<MapState>("/api/map/state"),
  conquerProvince: (provinceId: string, polityId: string, changeType: MapChangeType) =>
    apiFetch<{ ok: true; change: MapProvinceChange }>(`/api/map/state/${provinceId}`, { method: "POST", body: { polityId, changeType } }),
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
};

// A spouse-death-of-old-age notice (surfaces for one season, then auto-clears).
export type SpouseDeathNotice = {
  lateWifeName: string | null;
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

export type RoutineRequirementView = {
  good?: { type: string; qty: number };
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

export type PopType = "slave" | "freeman" | "citizen";
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
  tiers: CatalogTier[];
};

export type VendorPrice = { good: string; buy: number; sell: number };

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
  season: string;
  buildings: OwnedBuilding[];
  pendingIncomeTotal: number;
  upkeepOwed: number;
  pendingGoods: Record<string, number>;
  storageCap: number;
  classSection: ClassSection;
  pops: Record<string, number>;
};

export type PeopleView = {
  foodGood: string;
  pops: { type: PopType; label: string; dismissLabel: string; hireCost: number; upkeepPerDay: number; foodPerDay: number; civic: boolean }[];
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
