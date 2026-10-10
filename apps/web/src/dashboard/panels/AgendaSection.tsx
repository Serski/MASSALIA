import { useState } from "react";
import { api, ApiError, type AgendaScopeView } from "../../api.js";
import { DashboardCard, titleCase } from "../shared.js";

// One government's agenda card (the Agenda & three governments, Politics
// Prompt 3), moved out of PoliticsPanel.tsx unchanged for the Government tab
// (government prompt 1): the treasury card and the scope section with the
// drafting docket, the officials' draft and veto controls, and the card before
// the chamber.

// `ledger` false shows the label and the balance alone (the League treasury's
// amount on the Council tab, government prompt 1): no rows, no empty-books line.
export function TreasuryCard({ treasury, ledger = true }: { treasury: AgendaScopeView["treasury"]; ledger?: boolean }) {
  const label = treasury.owner === "league" ? "League treasury" : `${titleCase(treasury.owner)} treasury`;
  return (
    <DashboardCard className="treasury-card">
      <div className="event-body">
        <span className="dashboard-label">{label}</span>
        <p className="treasury-balance">{treasury.balance.toLocaleString()} <span className="treasury-unit">drachmae</span></p>
        {!ledger ? null : treasury.ledger.length > 0 ? (
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
// `treasury`: "full" is the treasury card with its ledger (the party tab),
// "amount" the label and balance alone (the Council tab), "none" no treasury
// (the Government tab shows the books itself).
export function AgendaScopeSection({ view, onRefresh, treasury = "full" }: { view: AgendaScopeView; onRefresh: () => void; treasury?: "full" | "amount" | "none" }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setNote("");
    try { await fn(); setNote(ok); onRefresh(); } catch (err) { setNote(err instanceof ApiError ? err.message : "That could not be done."); } finally { setBusy(false); }
  };
  const drafted = view.cards.find((c) => c.id === view.draftedCardId);
  const kicker = view.scope === "league" ? "The League agenda" : view.scope === "festival" ? "The festival of the coming year" : `${titleCase(view.scope)} agenda`;
  // A festival's effects follow its passing; a project's follow its standing.
  const effectsPrefix = view.scope === "festival" ? "If it passes:" : "When it stands:";
  // The League's docket is building projects grouped by polis (government prompt
  // 2a): consecutive cards with the same `group` share a heading, in docket
  // order. Cards without a group (a party's) form one unheaded run.
  const sections: { group: string | null; cards: AgendaScopeView["cards"] }[] = [];
  for (const card of view.cards) {
    const group = card.group ?? null;
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.cards.push(card);
    else sections.push({ group, cards: [card] });
  }
  return (
    <DashboardCard className="agenda-card">
      <div className="event-body">
        <span className="dashboard-label agenda-kicker">{kicker}{view.phase ? ` · ${view.phase}` : ""}</span>
        {view.phase === "drafting" ? (
          <>
            <h3>{view.youMayDraft ? "Choose the measure that goes before the chamber." : "The officials weigh the docket."}</h3>
            {sections.map((section, i) => (
              <div key={section.group ?? `run-${i}`} className="agenda-group">
                {section.group ? <div className="panel-label agenda-group-label">{section.group}</div> : null}
                <div className="agenda-grid">
                  {section.cards.map((card) => {
                    const isDrafted = card.id === view.draftedCardId;
                    const isVetoed = card.id === view.vetoedCardId;
                    return (
                      <DashboardCard key={card.id} className={`agenda-choice${isDrafted ? " agenda-drafted" : ""}${isVetoed ? " agenda-vetoed" : ""}`}>
                        <div className="event-body">
                          <span className="dashboard-label">{card.title}</span>
                          <p className="agenda-flavor">{card.description}</p>
                          {card.effects?.length ? <p className="agenda-effects">{effectsPrefix} {card.effects.join(" · ")}</p> : null}
                          <span className="choice-costs">
                            <span className="cost-chip cost-neutral">{titleCase(card.partyLean)} lean</span>
                            {card.cost > 0 ? <span className="cost-chip cost-negative">{card.cost.toLocaleString()} dr.</span> : <span className="cost-chip cost-positive">Free</span>}
                            {card.seasons ? <span className="cost-chip cost-neutral agenda-seasons">{card.seasons} seasons</span> : null}
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
              </div>
            ))}
            {view.youMayVeto && drafted ? (
              <button className="dashboard-ghost-button agenda-veto-btn" type="button" disabled={busy} onClick={() => act(() => api.vetoAgenda(view.scope), `You vetoed ${drafted.title}.`)}>
                Veto {drafted.title} (one per term)
              </button>
            ) : null}
          </>
        ) : view.phase === "voting" ? (
          <>
            <h3>{drafted ? `"${drafted.title}" is before the chamber.` : "The chamber is in session."}</h3>
            {drafted?.effects?.length ? <p className="agenda-effects">{effectsPrefix} {drafted.effects.join(" · ")}</p> : null}
          </>
        ) : (
          <p className="dashboard-todo">No measure is in session.</p>
        )}
        {treasury === "none" ? null : <TreasuryCard treasury={view.treasury} ledger={treasury === "full"} />}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}
