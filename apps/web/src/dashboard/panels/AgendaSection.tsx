import { useState } from "react";
import { api, ApiError, type AgendaScopeView } from "../../api.js";
import { DashboardCard, titleCase } from "../shared.js";

// One government's agenda card (the Agenda & three governments, Politics
// Prompt 3), moved out of PoliticsPanel.tsx unchanged for the Government tab
// (government prompt 1): the treasury card and the scope section with the
// drafting docket, the officials' draft and veto controls, and the card before
// the chamber.

export function TreasuryCard({ treasury }: { treasury: AgendaScopeView["treasury"] }) {
  const label = treasury.owner === "league" ? "League treasury" : `${titleCase(treasury.owner)} treasury`;
  return (
    <DashboardCard className="treasury-card">
      <div className="event-body">
        <span className="dashboard-label">{label}</span>
        <p className="treasury-balance">{treasury.balance} <span className="treasury-unit">drachmae</span></p>
        {treasury.ledger.length > 0 ? (
          <ul className="treasury-ledger">
            {treasury.ledger.slice(0, 6).map((l, i) => (
              <li key={i}><span className={l.delta >= 0 ? "ledger-pos" : "ledger-neg"}>{l.delta >= 0 ? "+" : ""}{l.delta}</span> <span className="ledger-reason">{l.reason}</span></li>
            ))}
          </ul>
        ) : <p className="dashboard-todo">The books are empty.</p>}
      </div>
    </DashboardCard>
  );
}

// One government's agenda: the drafting docket (with the officials' draft/veto
// controls) or the drafted card going to the chamber, plus the treasury.
export function AgendaScopeSection({ view, onRefresh }: { view: AgendaScopeView; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote("");
    try { await fn(); setNote(ok); onRefresh(); } catch (err) { setNote(err instanceof ApiError ? err.message : "That could not be done."); } finally { setBusy(false); }
  };
  const drafted = view.cards.find((c) => c.id === view.draftedCardId);
  const kicker = view.scope === "league" ? "The League agenda" : `${titleCase(view.scope)} agenda`;
  return (
    <DashboardCard className="agenda-card">
      <div className="event-body">
        <span className="dashboard-label agenda-kicker">{kicker}{view.phase ? ` · ${view.phase}` : ""}</span>
        {view.phase === "drafting" ? (
          <>
            <h3>{view.youMayDraft ? "Choose the measure that goes before the chamber." : "The officials weigh the docket."}</h3>
            <div className="agenda-grid">
              {view.cards.map((card) => {
                const isDrafted = card.id === view.draftedCardId;
                const isVetoed = card.id === view.vetoedCardId;
                return (
                  <DashboardCard key={card.id} className={`agenda-choice${isDrafted ? " agenda-drafted" : ""}${isVetoed ? " agenda-vetoed" : ""}`}>
                    <div className="event-body">
                      <span className="dashboard-label">{card.title}</span>
                      <p className="agenda-flavor">{card.description}</p>
                      <span className="choice-costs">
                        <span className="cost-chip cost-neutral">{titleCase(card.partyLean)} lean</span>
                        {card.cost > 0 ? <span className="cost-chip cost-negative">{card.cost} dr.</span> : <span className="cost-chip cost-positive">Free</span>}
                        {isVetoed ? <span className="cost-chip cost-negative">Vetoed</span> : null}
                        {isDrafted ? <span className="cost-chip cost-positive">✓ drafted</span> : null}
                      </span>
                      {view.youMayDraft && !isVetoed ? (
                        <button className="event-choice-button" type="button" disabled={busy} onClick={() => act(() => api.draftAgenda(view.scope, card.id), `${card.title} goes to the chamber.`)}>
                          <strong>Put forward</strong>
                        </button>
                      ) : null}
                    </div>
                  </DashboardCard>
                );
              })}
            </div>
            {view.youMayVeto && drafted ? (
              <button className="dashboard-ghost-button agenda-veto-btn" type="button" disabled={busy} onClick={() => act(() => api.vetoAgenda(view.scope), `You vetoed ${drafted.title}.`)}>
                Veto {drafted.title} (one per term)
              </button>
            ) : null}
          </>
        ) : view.phase === "voting" ? (
          <h3>{drafted ? `"${drafted.title}" is before the chamber — cast your vote below.` : "The chamber is in session."}</h3>
        ) : (
          <p className="dashboard-todo">No measure is in session.</p>
        )}
        <TreasuryCard treasury={view.treasury} />
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}
