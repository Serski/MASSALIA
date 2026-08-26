import type { IconName } from "./shared.js";

// Shared onboarding / Guide copy. The welcome overlay and the Guide sheet both
// render from these atoms so the wording lives in exactly one place. Copy is
// authoritative — edit here, and every surface follows.

export type GuideTab = { icon: IconName; name: string; line: string };
export type GuideReading = { name: string; line: string };
export type GuideSection = { id: string; title: string; paragraphs: string[] };

export const GUIDE_TITLE = "Welcome to Massalia";

export const GUIDE_FRAMING =
  "One real day is one season of your life — three months by the calendar. Build, trade, marry, scheme — and leave an heir worthy of the name.";

export const GUIDE_TABS: GuideTab[] = [
  {
    icon: "court",
    name: "Court",
    line: "Your daily audience. Each day deals a fresh hand of decisions, one per arena, each resolvable once — they expire with the day.",
  },
  {
    icon: "ledger",
    name: "Ledger",
    line: "Your holdings. Build and upgrade your class buildings, collect income, manage your workers.",
  },
  {
    icon: "market",
    name: "Market",
    line: "The agora. Buy and sell goods; hire slaves, freemen, and citizens.",
  },
  {
    icon: "family",
    name: "Family",
    line: "Marry well: every bride arrives with a retinue, some with dowries besides. A new draw of brides arrives each season if none please you. Raise children; secure your heir.",
  },
  {
    icon: "politics",
    name: "Politics",
    line: "Parties, elections, offices. Join the PALAIOI or DYNATOI and climb toward the archonship.",
  },
  {
    icon: "atlas",
    name: "Atlas",
    line: "The world beyond the walls: league cities, factions, standings.",
  },
];

export const GUIDE_READING_HEADER = "Reading your character:";

export const GUIDE_READING: GuideReading[] = [
  {
    name: "Stats",
    line: "Prestige, Devotion, Militia, Intelligence, each 0–100. Your class favors one. Age wears them down — Prestige alone never fades.",
  },
  {
    name: "Composure",
    line: "your steadiness. Hard blows drain it; time restores it, faster with a devoted wife. Emptied, you withdraw until you recover.",
  },
  {
    name: "Philia",
    line: "your wife's bond to you. Gifts and symposia raise it — and a devoted wife steadies your composure. Neglect invites complications.",
  },
];

export const GUIDE_TIP = "First day: marry — put the dowry into your class building — and join a party.";

export const GUIDE_CLOSER =
  "Your portrait in the top bar holds your stats, achievements, and settings — start there.";

// Longer-form Guide sections. Empty in this phase; populated when the Guide sheet lands.
export const GUIDE_SECTIONS: GuideSection[] = [];
