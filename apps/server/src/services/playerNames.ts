import { and, eq, ne, sql } from "drizzle-orm";
import { players, type DbExec } from "@massalia/db";

// Active players' names are unique per world, case-insensitively (migration 0050).
// A player-typed name that collides is refused with a 409 (routes/characters.ts);
// a SERVER-generated rename — an heir taking over the slot — must never fail, so
// it is disambiguated instead: "Name", then "Name II", "Name III", … "Name X",
// then a short id-derived suffix as the last resort.
const NUMERALS = ["II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export async function nameTaken(exec: DbExec, worldId: string, name: string, exceptPlayerId: string | null): Promise<boolean> {
  const rows = await exec
    .select({ id: players.id })
    .from(players)
    .where(
      and(
        eq(players.worldId, worldId),
        eq(players.isActive, true),
        sql`lower(${players.name}) = lower(${name})`,
        ...(exceptPlayerId ? [ne(players.id, exceptPlayerId)] : []),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function uniquePlayerName(exec: DbExec, worldId: string, desired: string, exceptPlayerId: string | null): Promise<string> {
  if (!(await nameTaken(exec, worldId, desired, exceptPlayerId))) return desired;
  for (const numeral of NUMERALS) {
    const candidate = `${desired} ${numeral}`;
    if (!(await nameTaken(exec, worldId, candidate, exceptPlayerId))) return candidate;
  }
  return `${desired} ${Math.random().toString(36).slice(2, 6)}`;
}
