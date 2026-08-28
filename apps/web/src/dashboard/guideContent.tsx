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

// The overlay's final line, pointing the player to the always-available Guide.
export const GUIDE_REREAD = "Read this again anytime — Guide, in the sidebar.";

// Longer-form Guide sections (Guide sheet only — not in the first-run overlay).
export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "calendar",
    title: "The Calendar & Seasons",
    paragraphs: [
      "Each day is a season; four days make a year, and the round spans a generation and more. The seasons are not scenery: fields sleep in winter and wake in summer, and the vendor's prices breathe with them. You age on the same clock — Prime, Middle Age, Old, Venerable — and your stats wear down with the years. Prestige alone never fades. Each season brings its festivals; attend them.",
    ],
  },
  {
    id: "holdings",
    title: "Your Holdings & Your People",
    paragraphs: [
      "Your class building is one structure raised through four tiers, upgraded in place: it keeps producing through every upgrade, and only a fresh first build earns nothing until it stands. The first tier rises within the hour; the rest take days. Beyond it lie the commons — farms, vines, timber, the shrine — open to any class. Buildings need hands: slaves are bought outright, eat from your stores, and can be sold back; freemen and citizens work for wages. Your holdings labor while you sleep — income accrues whether you watch or not.",
    ],
  },
  {
    id: "family",
    title: "Family & the Line",
    paragraphs: [
      "Every bride arrives with her retinue; some bring dowries besides, and a new draw comes each season. Philia is her bond: a gift costs 25 drachmae and deepens it by 5 — but only once a year; repeat gifts barely move her. Symposia work too, and a devoted wife steadies your composure faster. Raise children and name your heir. The adoption rite opens at thirty — and should you die heirless, it is performed regardless: the line does not end. Your heir keeps the house, the holdings, the coin, the council seat, and a measure of your prestige; the rest he earns himself. Divorce is possible, and costs dearly.",
    ],
  },
  {
    id: "politics",
    title: "The City's Politics",
    paragraphs: [
      "Two parties contest the city: the PALAIOI, keepers of the old ways, and the DYNATOI, men of the new. Join one and build favor. The Archons and Ephors are elected — declare, campaign, win the vote, take office; the Strategoi are appointed. The wealthy may buy a seat among the Three Hundred. But choose your ambition: a party's for-life leader may never stand for the city's offices — machine boss or magistrate, not both. The unfree have no voice until freedom.",
    ],
  },
];
