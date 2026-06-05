const configuredApiUrl = import.meta.env.VITE_API_URL;

if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error("VITE_API_URL is required for production builds. Refusing to use a localhost API URL.");
}

export const apiBaseUrl = (configuredApiUrl ?? (import.meta.env.DEV ? "http://localhost:3001" : "")).replace(/\/$/, "");

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
};
