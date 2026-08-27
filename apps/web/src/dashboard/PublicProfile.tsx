import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AssassinateOutcome, type PoisonOutcome, type PublicProfileView } from "../api.js";
import { BottomSheet } from "./sheets.js";
import { titleCase } from "./shared.js";

// The seat/standings key the profile opens on, plus whether it is the viewer's own
// dynasty (the caller knows: standings row.isViewer / the hemicycle's own seat). The
// server also computes isSelf on the profile and wins; this is only a fallback while
// the profile loads.
export type ProfileTarget = { characterId: string; isSelf: boolean };

const PARTY_LABEL: Record<string, string> = {
  palaioi: "Palaioi",
  dynatoi: "Dynatoi",
  none: "Independent",
};

function partyLabel(party: string): string {
  return PARTY_LABEL[party] ?? titleCase(party);
}

function poisonOutcomeMessage(outcome: PoisonOutcome, name: string): string {
  if (outcome === "dead") return `${name} is dead. The venom did its work.`;
  if (outcome === "ill") return `${name} has fallen gravely ill.`;
  return `The attempt on ${name} failed — no one is the wiser.`;
}

function assassinateOutcomeMessage(outcome: AssassinateOutcome, name: string): string {
  if (outcome === "dead") return `${name} is dead. The blade found its mark.`;
  return "The blade was turned aside — no one is the wiser.";
}

// The public character profile — opened from the hemicycle (a player-held seat) or
// a standings row. Public facts only; the interaction row(s) — send drachmae, and
// the hostile poison action — are gated to seat-holders and shown visible-but-locked
// with a reason when the viewer may not act (mirrors the slave-class Politics lock).
export function PublicProfile({
  target,
  onClose,
  onInteracted,
}: {
  target: ProfileTarget | null;
  onClose: () => void;
  onInteracted?: () => void;
}) {
  const open = target !== null;
  const characterId = target?.characterId ?? null;
  const [profile, setProfile] = useState<PublicProfileView | null>(null);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmingPoison, setConfirmingPoison] = useState(false);
  const [confirmingBlade, setConfirmingBlade] = useState(false);

  const load = useCallback(() => {
    if (characterId === null) return;
    setProfile(null);
    setError("");
    setNote("");
    setAmount("");
    setConfirmingPoison(false);
    setConfirmingBlade(false);
    api
      .publicProfile(characterId)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiError ? err.message : "This citizen's record could not be read."));
  }, [characterId]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // The server's isSelf is authoritative; the caller hint covers the pre-load window.
  const isSelf = profile?.isSelf ?? target?.isSelf ?? false;
  const amountNum = Number(amount);
  const amountValid = amount.trim() !== "" && Number.isInteger(amountNum) && amountNum >= 1;

  const send = async () => {
    if (!profile || !amountValid) return;
    setBusy(true);
    setNote("");
    try {
      const result = await api.giveDrachmae(profile.characterId, amountNum);
      setNote(`Sent ${result.amount.toLocaleString()} drachmae to ${profile.name}.`);
      setAmount("");
      onInteracted?.();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The gift could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  const poison = async () => {
    if (!profile) return;
    setBusy(true);
    setNote("");
    try {
      const result = await api.poison(profile.characterId);
      setNote(poisonOutcomeMessage(result.outcome, profile.name));
      onInteracted?.();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The attempt could not be made.");
    } finally {
      setBusy(false);
      setConfirmingPoison(false);
    }
  };

  const assassinate = async () => {
    if (!profile) return;
    setBusy(true);
    setNote("");
    try {
      const result = await api.assassinate(profile.characterId);
      setNote(assassinateOutcomeMessage(result.outcome, profile.name));
      onInteracted?.();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The attempt could not be made.");
    } finally {
      setBusy(false);
      setConfirmingBlade(false);
    }
  };

  return (
    <BottomSheet open={open} onClose={onClose} labelledBy="public-profile-title" title={profile ? profile.name : "Citizen"}>
      {error ? <p className="dashboard-todo" role="status">{error}</p> : null}
      {!profile && !error ? <p className="dashboard-todo">Reading the citizen's record…</p> : null}
      {profile ? (
        <>
          <div className="sheet-label">Public record</div>
          <div className="sheet-row">
            <span className="sheet-row-ic" aria-hidden="true">🏛️</span>
            <div className="sheet-row-body">
              <strong>{profile.name} of House {profile.houseName}</strong>
              <span>
                {titleCase(profile.classId)} · {partyLabel(profile.party)}
                {profile.seatIndex !== null ? ` · seat ${profile.seatIndex} of the Three Hundred` : ""}
                {!profile.isAlive ? " · deceased" : ""}
              </span>
            </div>
            <span className="sheet-row-tag tone-neutral">Prestige {profile.prestige}</span>
          </div>

          {isSelf ? null : (
            <>
              <div className="sheet-label">Interactions</div>
              {profile.viewer.canInteract ? (
                <div className="sheet-row">
                  <span className="sheet-row-ic" aria-hidden="true">🪙</span>
                  <div className="sheet-row-body">
                    <strong>Send drachmae</strong>
                    <span>A gift of coin to {profile.name}.</span>
                  </div>
                  <span className="sheet-row-action" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <input
                      className="set-input"
                      style={{ width: 96 }}
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      placeholder="Amount"
                      aria-label="Amount of drachmae to send"
                      value={amount}
                      disabled={busy}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                    <button type="button" className="panel-btn" disabled={busy || !amountValid} onClick={send}>
                      Send
                    </button>
                  </span>
                </div>
              ) : (
                <div className="sheet-row dim">
                  <span className="sheet-row-ic" aria-hidden="true">🪙</span>
                  <div className="sheet-row-body">
                    <strong>Send drachmae</strong>
                    <span>{profile.viewer.lockReason ?? "You cannot interact with this citizen."}</span>
                  </div>
                  <button type="button" className="panel-btn ghost" disabled>
                    Send
                  </button>
                </div>
              )}

              {/* Poison — the hostile action, destructive styling + a confirm step. */}
              {profile.viewer.canPoison ? (
                <div className="sheet-row profile-poison-row">
                  <span className="sheet-row-ic" aria-hidden="true">☠️</span>
                  <div className="sheet-row-body">
                    <strong>Poison</strong>
                    <span>{confirmingPoison ? "A hostile, hidden attempt on their life. This cannot be undone." : `Move against ${profile.name} in the shadows.`}</span>
                  </div>
                  {confirmingPoison ? (
                    <span className="sheet-row-action" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => setConfirmingPoison(false)}>
                        Cancel
                      </button>
                      <button type="button" className="panel-btn danger" disabled={busy} onClick={poison}>
                        Confirm
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="panel-btn danger" disabled={busy} onClick={() => setConfirmingPoison(true)}>
                      Poison
                    </button>
                  )}
                </div>
              ) : (
                <div className="sheet-row dim">
                  <span className="sheet-row-ic" aria-hidden="true">☠️</span>
                  <div className="sheet-row-body">
                    <strong>Poison</strong>
                    <span>{profile.viewer.poisonLockReason ?? "You cannot move against this citizen."}</span>
                  </div>
                  <button type="button" className="panel-btn ghost" disabled>
                    Poison
                  </button>
                </div>
              )}

              {/* Assassinate — a paid blade; success is death. Destructive + a confirm step. */}
              {profile.viewer.canAssassinate ? (
                <div className="sheet-row profile-poison-row">
                  <span className="sheet-row-ic" aria-hidden="true">🗡️</span>
                  <div className="sheet-row-body">
                    <strong>Assassinate</strong>
                    <span>{confirmingBlade ? `Hire a blade — ${profile.viewer.assassinateCost} drachmae, whatever the outcome. If it strikes true, they die.` : `Send a blade for ${profile.name}.`}</span>
                  </div>
                  {confirmingBlade ? (
                    <span className="sheet-row-action" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button type="button" className="panel-btn ghost" disabled={busy} onClick={() => setConfirmingBlade(false)}>
                        Cancel
                      </button>
                      <button type="button" className="panel-btn danger" disabled={busy} onClick={assassinate}>
                        Confirm · {profile.viewer.assassinateCost} dr
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="panel-btn danger" disabled={busy} onClick={() => setConfirmingBlade(true)}>
                      Assassinate
                    </button>
                  )}
                </div>
              ) : (
                <div className="sheet-row dim">
                  <span className="sheet-row-ic" aria-hidden="true">🗡️</span>
                  <div className="sheet-row-body">
                    <strong>Assassinate</strong>
                    <span>{profile.viewer.assassinateLockReason ?? "You cannot move against this citizen."}</span>
                  </div>
                  <button type="button" className="panel-btn ghost" disabled>
                    Assassinate
                  </button>
                </div>
              )}
              {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
            </>
          )}
        </>
      ) : null}
    </BottomSheet>
  );
}
