import type { ReactNode } from "react";
import { api, hasSessionHint } from "../api.js";
import { assetPath } from "../data/league.js";
import { navigateTo } from "../navigate.js";
import { DISCORD_INVITE_URL } from "./links.js";
import "./lobby.css";

// The frame every lobby page shares: the brand, the nav (Lobby, News, Guides,
// Discord when an invite is set), then Log out with a session hint or Login /
// Sign Up without one, and the legal footer. It reads the session hint itself
// and makes no API call, so the public pages (/news, /guides) render at once
// for strangers. No Admin link: /admin stays reachable by URL only.
export type LobbyNavItem = "lobby" | "news" | "guides";

const NAV: Array<{ id: LobbyNavItem; label: string; path: string }> = [
  { id: "lobby", label: "Lobby", path: "/lobby" },
  { id: "news", label: "News", path: "/news" },
  { id: "guides", label: "Guides", path: "/guides" },
];

export function LobbyFrame({ active, children }: { active: LobbyNavItem; children: ReactNode }) {
  const returning = hasSessionHint();

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      navigateTo("/");
    }
  };

  return (
    <main className="landing-shell lobby-shell">
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
          {NAV.map((item) => (
            <a
              key={item.id}
              className={`lobby-link${item.id === active ? " lobby-nav-active" : ""}`}
              href={item.path}
              aria-current={item.id === active ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigateTo(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
          {DISCORD_INVITE_URL ? (
            <a className="lobby-link" href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer">Discord</a>
          ) : null}
          {returning ? (
            <button className="lobby-btn lobby-btn-small" type="button" onClick={logout}>Log out</button>
          ) : (
            <>
              <button className="lobby-btn lobby-btn-small" type="button" onClick={() => navigateTo("/login")}>Login</button>
              <button className="lobby-btn lobby-btn-small" type="button" onClick={() => navigateTo("/create")}>Sign Up</button>
            </>
          )}
        </nav>
      </header>
      {children}
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
