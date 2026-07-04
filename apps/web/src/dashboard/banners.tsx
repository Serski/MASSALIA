import { useState } from "react";
import { api, ApiError, type EventResolution, type FestivalLive, type OlympiadStatus } from "../api.js";
import { assetPath } from "../data/league.js";
import { DashboardCard, PanelBanner } from "./shared.js";

// Background art for festival & Olympic events, keyed by festivalId / eventId.
// Events absent from this map fall back to the PanelBanner placeholder.
export const EVENT_ART: Record<string, string> = {
  "fest-dionysia": assetPath("assets/Dionysia.webp"),
  "fest-artemisia": assetPath("assets/Artemisia.webp"),
  "fest-apollo": assetPath("assets/Apollonia.webp"),
  "olympic-nominate": assetPath("assets/Olympic.webp"),
  "olympic-games": assetPath("assets/Olympic.webp"),
};

// A small dismiss (✕) control every card carries (Bug 4): the player may clear any
// card on demand; cards otherwise persist (resolved/dimmed) until the next day.
export function CardClose({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="card-close" aria-label="Dismiss this card" title="Dismiss" onClick={onClose}>
      ✕
    </button>
  );
}

// A festival is a free civic event — surfaced prominently, above the daily
// decisions, with each donation tier's previewed effects. After the offering is
// made it STAYS in a resolved/dimmed state (Bug 4) until dismissed or the next day.
export function FestivalBanner({ festival, onRefresh, onClose }: { festival: FestivalLive; onRefresh: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<EventResolution | null>(null);

  const choose = async (choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveFestival(festival.festivalId, choiceId);
      setOutcome(result);
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The festival offering could not be made.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardCard className={`festival-card${outcome ? " card-resolved" : ""}`}>
      <CardClose onClose={onClose} />
      <PanelBanner scene={festival.event.scene} art={EVENT_ART[festival.festivalId]} />
      <div className="event-body">
        <span className="dashboard-label festival-kicker">🎭 Festival · free civic event</span>
        <h3>{festival.event.scene}</h3>
        {outcome ? (
          <div className="event-outcome" role="status">
            <p>{outcome.resultText}</p>
            {outcome.composureDelta !== 0 ? (
              <p className={`composure-note ${outcome.composureDelta < 0 ? "neg" : "pos"}`}>
                {outcome.composureDelta > 0 ? "+" : ""}{outcome.composureDelta} Composure — {outcome.composureReason}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="event-choice-stack">
            {festival.event.choices.map((choice) => (
              <button className="event-choice-button" type="button" key={choice.id} disabled={busy} onClick={() => choose(choice.id)}>
                <strong>{choice.label}</strong>
                {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                  <span className="choice-costs">
                    {choice.costs.map((cost, i) => (
                      <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                    ))}
                    {choice.composureDelta !== 0 ? (
                      <span className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={choice.composureReason}>
                        {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}

// The live Olympic event (nominate / the Games) — surfaced like a festival: free,
// no daily decision spent. On the Games it reveals the victor/honorable outcome.
export function OlympicBanner({ live, onRefresh, onClose }: { live: NonNullable<OlympiadStatus["liveEvent"]>; onRefresh: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<EventResolution | null>(null);
  const [victory, setVictory] = useState<{ won: boolean } | null>(null);

  const choose = async (choiceId: string) => {
    setBusy(true);
    setNote("");
    try {
      const result = await api.resolveOlympic(choiceId);
      setOutcome(result);
      if (result.compete) setVictory({ won: result.compete.won });
      onRefresh();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "The herald could not record your choice.");
    } finally {
      setBusy(false);
    }
  };

  const isGames = live.eventId === "olympic-games";
  return (
    <DashboardCard className={`olympic-card${outcome ? " card-resolved" : ""}`}>
      <CardClose onClose={onClose} />
      <PanelBanner scene={live.event.scene} art={EVENT_ART[live.eventId]} />
      <div className="event-body">
        <span className="dashboard-label olympic-kicker">{isGames ? "🏛️ The Olympic Games" : "🏛️ The Olympiad · the assembly nominates"}</span>
        <h3>{live.event.scene}</h3>
        {outcome ? (
          <div className="event-outcome" role="status">
            {victory ? (
              <p className={victory.won ? "olympic-victory" : "composure-note"}>
                {victory.won ? "🥇 Olive crown! Massalia crowns an Olympionikes." : "An honorable showing — the city is not shamed."}
              </p>
            ) : null}
            <p>{outcome.resultText}</p>
          </div>
        ) : (
          <div className="event-choice-stack">
            {live.event.choices.map((choice) => (
              <button className="event-choice-button" type="button" key={choice.id} disabled={busy} onClick={() => choose(choice.id)}>
                <strong>{choice.label}</strong>
                {choice.costs.length > 0 || choice.composureDelta !== 0 ? (
                  <span className="choice-costs">
                    {choice.costs.map((cost, i) => (
                      <span key={i} className={`cost-chip cost-${cost.tone}`}>{cost.label}</span>
                    ))}
                    {choice.composureDelta !== 0 ? (
                      <span className={`cost-chip ${choice.composureDelta < 0 ? "cost-negative" : "cost-positive"}`} title={choice.composureReason}>
                        {choice.composureDelta > 0 ? "+" : ""}{choice.composureDelta} Composure
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        )}
        {note ? <p className="dashboard-todo" role="status">{note}</p> : null}
      </div>
    </DashboardCard>
  );
}
