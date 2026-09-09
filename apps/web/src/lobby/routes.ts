// The lobby's sub-routes: one page, three views. Pure, so App.tsx and the
// tests can map a pathname without rendering anything.
export type LobbyView = "worlds" | "account" | "hall-of-fame";

const VIEWS: Record<string, LobbyView> = {
  "/lobby": "worlds",
  "/lobby/account": "account",
  "/lobby/hall-of-fame": "hall-of-fame",
};

export function lobbyViewFor(pathname: string): LobbyView | null {
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return VIEWS[trimmed] ?? null;
}
