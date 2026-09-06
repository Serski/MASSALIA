// ---------------------------------------------------------------------------
// Legacy world-state seam. The prototype /api/world routes (state + SSE stream)
// and their client are gone; what remains is the province-owner token store the
// event engine's `set_province_owner` effect writes, and broadcastState(), which
// every mutating service still calls after a commit. There are no subscribers
// any more, so it is a no-op kept as the single hook point for a future
// realtime channel (the world 2 map polls / reads through its own routes).
// ---------------------------------------------------------------------------

const owners = [
  { id: "player-phocaean", name: "House Phocaean" },
  { id: "player-aurelian", name: "Aurelian League" },
] as const;
const firstOwner = owners[0];
const secondOwner = owners[1];

// province id -> owner id, as set by `set_province_owner` event effects.
const dynamicOwners = new Map<string, string>();

export function setProvinceOwner(provinceId: string, ownerPlayerId: string) {
  dynamicOwners.set(provinceId, ownerPlayerId);
  void broadcastState();
}

export function provinceOwner(provinceId: string): string | undefined {
  return dynamicOwners.get(provinceId);
}

export function resolveOwnerToken(ownerPlayerId: string) {
  if (ownerPlayerId === "FIRST_PLAYER") return firstOwner.id;
  if (ownerPlayerId === "SECOND_PLAYER") return secondOwner.id;
  return ownerPlayerId;
}

// Post-commit fan-out hook. No subscribers since the legacy stream was removed.
export async function broadcastState(): Promise<void> {}
