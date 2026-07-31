import { useCallback, useEffect, useState } from "react";
import { api, ApiError, contentUrl, type StoryAdvanceView, type StoryChoiceView, type StoryNodeView, type StoryStateView } from "../api.js";
import { BottomSheet } from "./sheets.js";
import { DashboardCard, PanelBanner } from "./shared.js";

// A step-flow over the story service, on the house BottomSheet. The server's node
// is the ONLY source of truth — no local step counter — so opening an `active`
// story resumes at its currentNode, not the start. Rewards are never in the payload
// (the narrative carries the outcome); stats update via onRefresh.

// Both projection shapes normalized to { node, choices }. start/state expose
// `choices` beside `node`; advance nests them in the node.
type View = { node: StoryNodeView; choices: StoryChoiceView[] };
const fromState = (s: StoryStateView): View => ({ node: s.node, choices: s.choices ?? [] });
const fromAdvance = (a: StoryAdvanceView): View => ({ node: a.node, choices: a.node.choices ?? [] });
const isTerminal = (v: View) => v.node.type === "terminal";

export default function StorySheet({
  storyId,
  open,
  onClose,
  onRefresh,
}: {
  storyId: string;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [interstitial, setInterstitial] = useState<string | null>(null); // resultText awaiting Continue
  const [pending, setPending] = useState<View | null>(null); // node to show after the interstitial
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Refresh /me/state on close (and, separately, when a terminal is reached) — NOT
  // on every advance. onRefresh may re-order/clear the entry card behind the sheet.
  const handleClose = useCallback(() => {
    onRefresh();
    onClose();
  }, [onRefresh, onClose]);

  // Open → start (idempotent: fresh start OR resume both land on the server's currentNode).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setView(null);
    setInterstitial(null);
    setPending(null);
    setBusy(false);
    setError("");
    api
      .storyStart(storyId)
      .then((s) => {
        if (!cancelled) setView(fromState(s));
      })
      .catch((err) => {
        // A 403/404 on open leaves the sheet showing only this message + a Close.
        if (!cancelled) setError(err instanceof ApiError ? err.message : "This tale could not be opened.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, storyId]);

  const choose = async (choiceId: string) => {
    if (busy) return; // in-flight guard: a double-tap can't double-send
    setBusy(true);
    setError("");
    try {
      const adv = await api.storyAdvance(storyId, choiceId);
      const next = fromAdvance(adv);
      if (adv.completed) onRefresh(); // a terminal was reached
      if (adv.resultText) {
        setInterstitial(adv.resultText); // show the blurb; the node waits behind Continue
        setPending(next);
      } else {
        setView(next);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That choice could not be made.");
    } finally {
      setBusy(false);
    }
  };

  const continueFromInterstitial = () => {
    if (pending) setView(pending);
    setInterstitial(null);
    setPending(null);
  };

  return (
    <BottomSheet open={open} onClose={handleClose} labelledBy="story-sheet-title" title="A matter requires you">
      <DashboardCard className="event-card">
        <div className="event-body">
          {!view ? (
            error ? (
              // Open failed (e.g. 403 not_eligible / 404): message + a single Close.
              <>
                <p className="dashboard-todo" role="status">{error}</p>
                <div className="event-choice-stack">
                  <button className="event-choice-button" type="button" onClick={handleClose}>
                    <strong>Close</strong>
                  </button>
                </div>
              </>
            ) : (
              <p className="dashboard-todo">Loading…</p>
            )
          ) : interstitial !== null ? (
            // Interstitial blurb (styled like the daily cards' .event-outcome).
            <div className="event-outcome" role="status">
              <p>{interstitial}</p>
              <div className="event-choice-stack">
                <button className="event-choice-button" type="button" onClick={continueFromInterstitial}>
                  <strong>Continue</strong>
                </button>
              </div>
            </div>
          ) : (
            <>
              {view.node.body.eyebrow ? <span className="dashboard-label event-kicker">{view.node.body.eyebrow}</span> : null}
              {view.node.image ? <PanelBanner scene="" art={contentUrl(view.node.image)} /> : null}
              {view.node.body.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
              {isTerminal(view) ? (
                <div className="event-choice-stack">
                  <button className="event-choice-button" type="button" onClick={handleClose}>
                    <strong>The tale is ended</strong>
                  </button>
                </div>
              ) : (
                <div className="event-choice-stack">
                  {view.choices.map((choice) => (
                    <button
                      className="event-choice-button"
                      type="button"
                      key={choice.id}
                      disabled={busy}
                      onClick={() => choose(choice.id)}
                    >
                      <strong>{choice.text}</strong>
                    </button>
                  ))}
                </div>
              )}
              {error ? <p className="dashboard-todo" role="status">{error}</p> : null}
            </>
          )}
        </div>
      </DashboardCard>
    </BottomSheet>
  );
}
