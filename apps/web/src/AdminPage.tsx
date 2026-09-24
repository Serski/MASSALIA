import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type AdminCharacter, type AdminCluster, type AdminLogRow, type AdminSheet, type AdminStat, type AdminUser } from "./api.js";

// ---------------------------------------------------------------------------
// /admin — a plain operator page (no styling work by design). Gated by the API:
// every call needs an admin session, so a non-admin only ever sees the refusal.
// User search, the same-IP cluster view, a character's stats and inventory, and
// the actions as buttons with a confirmation. Every action is audited server-side.
// ---------------------------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof ApiError ? `${error.status}: ${error.message}` : "Request failed.";
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) : "—");

const STATS: AdminStat[] = ["prestige", "devotion", "militia", "intelligence"];
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
// Goods bank fractionally; the player sees the floor, so show it first.
const amountText = (amount: number) => (Number.isInteger(amount) ? String(amount) : `${Math.floor(amount)} (${amount.toFixed(2)})`);

// Ask for a relative amount and a reason; null when either is cancelled or invalid.
function promptAdjust(name: string, what: string, current: string): { delta: number; reason: string } | null {
  const raw = window.prompt(`Adjust ${name}'s ${what} (currently ${current}). Relative amount, e.g. -5 or 10:`);
  const delta = Number(raw);
  if (!raw || !Number.isInteger(delta) || delta === 0) return null;
  const reason = window.prompt("Reason (audited):");
  if (!reason?.trim()) return null;
  return { delta, reason: reason.trim() };
}

export function AdminPage() {
  const [allowed, setAllowed] = useState<"pending" | "yes" | "no">("pending");
  const [query, setQuery] = useState("");
  const [verified, setVerified] = useState<"any" | "yes" | "no">("any");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cluster, setCluster] = useState<AdminCluster | null>(null);
  const [log, setLog] = useState<{ title: string; rows: AdminLogRow[] } | null>(null);
  const [sheet, setSheet] = useState<AdminSheet | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api.me()
      .then((me) => setAllowed(me.isAdmin ? "yes" : "no"))
      .catch(() => setAllowed("no"));
  }, []);

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    setStatus("Searching…");
    try {
      const result = await api.adminUsers(query.trim(), verified === "any" ? {} : { verified: verified === "yes" });
      setUsers(result.users);
      setStatus(`${result.users.length} user(s)`);
    } catch (error) {
      setStatus(errorText(error));
    }
  };

  // Run an action after a confirmation, then refresh the list and any open sheet.
  // The outcome goes in the status line last, so the list refresh never hides it.
  const act = async (confirmText: string, work: () => Promise<unknown>, done: string) => {
    if (!window.confirm(confirmText)) return;
    try {
      await work();
      await search();
      if (sheet) setSheet(await api.adminSheet(sheet.characterId));
      setStatus(done);
    } catch (error) {
      setStatus(errorText(error));
    }
  };

  const ban = (user: AdminUser) => {
    const reason = window.prompt(`Ban ${user.email}. Reason (shown to the user):`);
    if (!reason?.trim()) return;
    void act(`Ban ${user.email} with reason "${reason}"? Their sessions end immediately.`, () => api.adminBan(user.id, reason.trim()), `Banned ${user.email}.`);
  };
  const unban = (user: AdminUser) => {
    const reason = window.prompt(`Unban ${user.email}. Note (optional):`) ?? "";
    void act(`Unban ${user.email}?`, () => api.adminUnban(user.id, reason.trim()), `Unbanned ${user.email}.`);
  };
  // The stuck World 1 players: registered, never verified, so /characters 403s.
  const verifyEmail = (user: AdminUser) => {
    const reason = window.prompt(`Verify ${user.email}. Note (optional):`) ?? "";
    void act(`Mark ${user.email} as email-verified? They will be able to create a character.`, () => api.adminVerify(user.id, reason.trim()), `Verified ${user.email}.`);
  };
  const dropSessions = (user: AdminUser) =>
    void act(`Delete every session of ${user.email}? They will have to log in again.`, () => api.adminDeleteSessions(user.id), `Sessions deleted for ${user.email}.`);
  const adjust = (character: { characterId: string; name: string; drachmae: number }) => {
    const input = promptAdjust(character.name, "drachmae", String(character.drachmae));
    if (!input) return;
    const { delta, reason } = input;
    void act(`${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} drachmae ${delta > 0 ? "to" : "from"} ${character.name}?`, () => api.adminAdjustDrachmae(character.characterId, delta, reason), `Wallet adjusted for ${character.name}.`);
  };
  // One stat, good or household line of the open sheet: relative, with a reason.
  const adjustLine = (open: AdminSheet, what: string, current: string, work: (delta: number, reason: string) => Promise<unknown>) => {
    const input = promptAdjust(open.name, what, current);
    if (!input) return;
    const { delta, reason } = input;
    void act(`${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} ${what} ${delta > 0 ? "to" : "from"} ${open.name}?`, () => work(delta, reason), `${capitalise(what)} adjusted for ${open.name}.`);
  };
  const showSheet = async (character: AdminCharacter) => {
    try {
      setSheet(await api.adminSheet(character.characterId));
    } catch (error) {
      setStatus(errorText(error));
    }
  };
  const rename = (character: AdminCharacter) => {
    const name = window.prompt(`Rename ${character.name} to:`);
    if (!name?.trim()) return;
    void act(`Rename ${character.name} to "${name.trim()}"?`, () => api.adminRename(character.characterId, name.trim()), `Renamed to ${name.trim()}.`);
  };
  const showCluster = async (user: AdminUser) => {
    try {
      setCluster(await api.adminCluster(user.id));
    } catch (error) {
      setStatus(errorText(error));
    }
  };
  const showLog = async (character: AdminCharacter, kind: "effects" | "interactions") => {
    try {
      const rows = kind === "effects" ? (await api.adminEffects(character.characterId)).effects : (await api.adminInteractions(character.characterId)).interactions;
      setLog({ title: `${character.name} — ${kind} (${rows.length})`, rows });
    } catch (error) {
      setStatus(errorText(error));
    }
  };

  if (allowed === "pending") return <main><p>Checking access…</p></main>;
  if (allowed === "no") {
    return (
      <main>
        <h1>Admin</h1>
        <p>Admin access required. <a href="/game">Back to the game</a></p>
      </main>
    );
  }

  return (
    <main>
      <h1>Admin</h1>
      <form onSubmit={search}>
        <label>
          Email or character name{" "}
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="search" />
        </label>{" "}
        <label>
          Verified{" "}
          <select value={verified} onChange={(event) => setVerified(event.target.value as "any" | "yes" | "no")}>
            <option value="any">any</option>
            <option value="yes">yes</option>
            <option value="no">no</option>
          </select>
        </label>{" "}
        <button type="submit">Search</button>{" "}
        <button type="button" onClick={() => { setQuery(""); void search(); }}>All recent</button>
      </form>
      <p role="status">{status}</p>

      {sheet ? (
        <section>
          <h2>{sheet.name} — stats and inventory</h2>
          <p>Amounts as stored: pending output banks when the player next loads the game, and every adjustment here settles it first.</p>
          <table border={1} cellPadding={4}>
            <thead><tr><th>Stat</th><th>Value</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td>Drachmae</td><td>{sheet.drachmae}</td>
                <td><button type="button" onClick={() => adjust(sheet)}>Adjust</button></td>
              </tr>
              {STATS.map((stat) => (
                <tr key={stat}>
                  <td>{capitalise(stat)}</td><td>{sheet.stats[stat]} / 100</td>
                  <td><button type="button" onClick={() => adjustLine(sheet, stat, String(sheet.stats[stat]), (delta, reason) => api.adminAdjustStat(sheet.characterId, stat, delta, reason))}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Goods</h3>
          <table border={1} cellPadding={4}>
            <thead><tr><th>Good</th><th>Held</th><th></th></tr></thead>
            <tbody>
              {sheet.goods.map((good) => (
                <tr key={good.type}>
                  <td>{good.label}</td><td>{amountText(good.amount)}</td>
                  <td><button type="button" onClick={() => adjustLine(sheet, good.label, amountText(good.amount), (delta, reason) => api.adminAdjustGoods(sheet.characterId, good.type, delta, reason))}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Household</h3>
          <table border={1} cellPadding={4}>
            <thead><tr><th>People</th><th>Kept</th><th></th></tr></thead>
            <tbody>
              {sheet.pops.map((pop) => (
                <tr key={pop.type}>
                  <td>{pop.label}</td><td>{pop.count}{pop.max !== null ? ` (max ${pop.max})` : ""}</td>
                  <td><button type="button" onClick={() => adjustLine(sheet, pop.label, String(pop.count), (delta, reason) => api.adminAdjustPops(sheet.characterId, pop.type, delta, reason))}>Adjust</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => setSheet(null)}>Close</button>
        </section>
      ) : null}

      <table border={1} cellPadding={4}>
        <thead>
          <tr>
            <th>Email</th><th>Verified</th><th>Banned</th><th>Last seen</th><th>IP</th><th>Characters</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}{user.isAdmin ? " (admin)" : ""}</td>
              <td>{user.emailVerifiedAt ? "yes" : "no"}</td>
              <td>{user.bannedAt ? `${fmt(user.bannedAt)} — ${user.banReason ?? ""}` : "no"}</td>
              <td>{fmt(user.lastSeenAt)}</td>
              <td>{user.lastIp ?? "—"}</td>
              <td>
                {user.characters.length ? (
                  <ul>
                    {user.characters.map((character) => (
                      <li key={character.characterId}>
                        {character.name} · {character.drachmae} dr ·{" "}
                        <span title="Prestige · Devotion · Militia · Intelligence">P {character.prestige} · D {character.devotion} · M {character.militia} · I {character.intelligence}</span>
                        {" "}· {character.status}{character.isActive ? "" : " · inactive"}{" "}
                        <button type="button" onClick={() => adjust(character)}>Adjust drachmae</button>{" "}
                        <button type="button" onClick={() => void showSheet(character)}>Stats &amp; inventory</button>{" "}
                        <button type="button" onClick={() => rename(character)}>Rename</button>{" "}
                        <button type="button" onClick={() => void showLog(character, "effects")}>Effects</button>{" "}
                        <button type="button" onClick={() => void showLog(character, "interactions")}>Interactions</button>
                      </li>
                    ))}
                  </ul>
                ) : "—"}
              </td>
              <td>
                {user.bannedAt ? <button type="button" onClick={() => unban(user)}>Unban</button> : <button type="button" onClick={() => ban(user)}>Ban</button>}{" "}
                {user.emailVerifiedAt ? null : <><button type="button" onClick={() => verifyEmail(user)}>Verify</button>{" "}</>}
                <button type="button" onClick={() => dropSessions(user)}>Delete sessions</button>{" "}
                <button type="button" onClick={() => void showCluster(user)}>Same-IP cluster</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {cluster ? (
        <section>
          <h2>Same-IP cluster for {cluster.user.email} (last {cluster.windowDays} days)</h2>
          <p>IPs: {cluster.ips.length ? cluster.ips.join(", ") : "none recorded"}</p>
          {cluster.related.length ? (
            <table border={1} cellPadding={4}>
              <thead><tr><th>Email</th><th>Shared IPs</th><th>Last seen</th><th>Banned</th></tr></thead>
              <tbody>
                {cluster.related.map((row) => (
                  <tr key={row.userId}>
                    <td>{row.email}</td><td>{row.sharedIps.join(", ")}</td><td>{fmt(row.lastSeenAt)}</td><td>{row.bannedAt ? fmt(row.bannedAt) : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>No other account shares these IPs.</p>}
          <button type="button" onClick={() => setCluster(null)}>Close</button>
        </section>
      ) : null}

      {log ? (
        <section>
          <h2>{log.title}</h2>
          <pre>{JSON.stringify(log.rows, null, 2)}</pre>
          <button type="button" onClick={() => setLog(null)}>Close</button>
        </section>
      ) : null}
    </main>
  );
}
