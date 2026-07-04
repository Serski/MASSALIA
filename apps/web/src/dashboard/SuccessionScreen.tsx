import { useState } from "react";
import { api, ApiError, type SuccessionState } from "../api.js";

// The blocking Succession screen: death notice -> heir reveal -> confirm, so the
// player always continues controlling a living character.
export function SuccessionScreen({ succession, onResolved }: { succession: SuccessionState; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const { epitaph, plan, heir, candidates } = succession;

  const succeed = async (candidateId?: string) => {
    setBusy(true);
    setError("");
    try {
      await api.succeed(candidateId);
      onResolved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The succession could not be settled.");
      setBusy(false);
    }
  };

  return (
    <main className="succession-shell">
      <section className="succession-card">
        <p className="section-eyebrow">Succession</p>
        <h1 className="succession-title">
          {epitaph.name}{epitaph.ladderTrait ? `, ${epitaph.ladderTrait}` : ""}, dies in the {epitaph.age}th year.
        </h1>
        <p className="succession-epitaph">{epitaph.lifeStage} · age {epitaph.age}. The house must pass to another.</p>

        {plan.kind === "forced_adoption" ? (
          <>
            <p>No blood remains to inherit. Choose a ward to adopt — they become the next head of your house.</p>
            <div className="succession-candidates">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`succession-candidate${picked === c.id ? " selected" : ""}`}
                  onClick={() => setPicked(c.id)}
                  aria-pressed={picked === c.id}
                >
                  <strong>{c.name}</strong>
                  <span>{c.sex === "male" ? "man" : "woman"} · age {c.age}</span>
                </button>
              ))}
            </div>
            <button className="primary-cta" type="button" disabled={busy || !picked} onClick={() => succeed(picked!)}>
              {busy ? "Settling…" : "Adopt and continue"}
            </button>
          </>
        ) : plan.kind === "regency" ? (
          <>
            <p>{heir ? `${heir.name} — ${heir.relation}.` : "Your heir is too young to rule."} A regent will govern in trust until the heir comes of age.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : "Appoint a regent and continue"}
            </button>
          </>
        ) : plan.kind === "fresh" ? (
          <>
            <p>The unfree leave nothing behind. Begin again, a new life in the city.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : "Begin anew"}
            </button>
          </>
        ) : (
          <>
            <p>{heir ? `Your heir: ${heir.name} — ${heir.relation}.` : "Your adopted heir takes the house."} Continue the line as the next head.</p>
            <button className="primary-cta" type="button" disabled={busy} onClick={() => succeed()}>
              {busy ? "Settling…" : heir ? `Continue as ${heir.name}` : "Continue the line"}
            </button>
          </>
        )}
        {error ? <p className="auth-message" role="status">{error}</p> : null}
      </section>
    </main>
  );
}
