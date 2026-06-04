const defaultApiUrl = import.meta.env.GITHUB_PAGES ? "https://server-production-dd9e.up.railway.app" : "http://localhost:3001";
const apiBaseUrl = (import.meta.env.VITE_API_URL ?? defaultApiUrl).replace(/\/$/, "");

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

async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(data.error ?? "Request failed", response.status);
  }
  return data as T;
}

export type AuthResponse = {
  user: { id: string; email: string } | null;
  hasCharacter: boolean;
};

export type CreationRequest = {
  classSlug: string;
  houseSlug: string;
  avatarId: string;
  name: string;
};

export type PlayerState = {
  user: { id: string; email: string };
  world: {
    id: string;
    name: string;
    seasonDay: number;
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
    party: string;
    origin: string;
  };
  resources: {
    gold: number;
    prestige: number;
    influence: number;
    classResource: {
      type: string;
      label: string;
      amount: number;
    };
  };
};

export const api = {
  register: (email: string, password: string) => apiFetch<AuthResponse>("/auth/register", { method: "POST", body: { email, password } }),
  login: (email: string, password: string) => apiFetch<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }),
  logout: () => apiFetch<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => apiFetch<AuthResponse>("/auth/me"),
  createCharacter: (payload: CreationRequest) => apiFetch("/characters", { method: "POST", body: payload }),
  state: () => apiFetch<PlayerState>("/me/state"),
};
