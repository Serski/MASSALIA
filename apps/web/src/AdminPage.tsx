import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, type AdminCharacter, type AdminCluster, type AdminLogRow, type AdminUser } from "./api.js";

// ---------------------------------------------------------------------------
// /admin — a plain operator page (no styling work by design). Gated by the API:
// every call needs an admin session, so a non-admin only ever sees the refusal.
// User search, the same-IP cluster view, and the actions as buttons with a
// confirmation. Every action is audited server-side.
// ---------------------------------------------------------------------------

function errorText(error: unknown): string {
  return error instanceof ApiError ? `${error.status}: ${error.message}` : "Request failed.";
}

const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) : "—");

export function AdminPage() {
  const [allowed, setAllowed] = useState<"pending" | "yes" | "no">("pending");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cluster, setCluster] = useState<AdminCluster | null>(null);
  const [log, setLog] = useState<{ title: string; rows: AdminLogRow[] } | null>(null);
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
      const result = await api.adminUsers(query.trim());
      setUsers(result.users);
      setStatus(`${result.users.length} user(s)`);
    } catch (error) {
      setStatus(errorText(error));
    }
  };

  // Run an action after a confirmation, then refresh the list.
  const act = async (confirmText: string, work: () => Promise<unknown>, done: string) => {
    if (!window.confirm(confirmText)) return;
    try {
      await work();
      setStatus(done);
      await search();
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
  const dropSessions = (user: AdminUser) =>
    void act(`Delete every session of ${user.email}? They will have to log in again.`, () => api.adminDeleteSessions(user.id), `Sessions deleted for ${user.email}.`);
  const adjust = (character: AdminCharacter) => {
    const raw = window.prompt(`Adjust ${character.name}'s drachmae (currently ${character.drachmae}). Relative amount, e.g. -500 or 200:`);
    const delta = Number(raw);
    if (!raw || !Number.isInteger(delta) || delta === 0) return;
    const reason = window.prompt("Reason (audited):");
    if (!reason?.trim()) return;
    void act(`${delta > 0 ? "Add" : "Remove"} ${Math.abs(delta)} drachmae ${delta > 0 ? "to" : "from"} ${character.name}?`, () => api.adminAdjustDrachmae(character.characterId, delta, reason.trim()), `Wallet adjusted for ${character.name}.`);
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
        <button type="submit">Search</button>{" "}
        <button type="button" onClick={() => { setQuery(""); void search(); }}>All recent</button>
      </form>
      <p role="status">{status}</p>

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
                        {character.name} · {character.drachmae} dr · {character.status}{character.isActive ? "" : " · inactive"}{" "}
                        <button type="button" onClick={() => adjust(character)}>Adjust drachmae</button>{" "}
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
