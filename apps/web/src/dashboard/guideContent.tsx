import type { IconName } from "./shared.js";

// Shared onboarding / Guide copy. The welcome overlay and the Guide sheet both
// render from these atoms so the wording lives in exactly one place. Copy is
// authoritative — edit here, and every surface follows.

export type GuideTab = { icon: IconName; name: string; line: string };
export type GuideReading = { name: string; line: string };
// A section is its paragraphs, then any richer blocks (a reference entry's
// headings, lists and tables), rendered by GuideBlocks on both surfaces.
export type GuideTable = { caption: string; columns: string[]; rows: string[][] };
export type GuideBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; table: GuideTable };
export type GuideSection = { id: string; title: string; paragraphs: string[]; blocks?: GuideBlock[] };

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
    icon: "barracks",
    name: "Barracks",
    line: "Raise men from your levy or hire bands passing through the city. They eat every day whether they march or not.",
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
      "Two parties contest the city: the PALAIOI, keepers of the old ways, and the DYNATOI, men of the new. Join one and build favor. The Archons and Ephors are elected — declare, campaign, win the vote, take office; the Strategoi are appointed by them, from any citizen with a seat and a Militia above 40, of either party or none, and serve until the term ends. The wealthy may buy a seat among the Three Hundred. A party's for-life leaders may stand for the city's offices too. The unfree have no voice until freedom.",
    ],
  },
  // Strikes prompt 1 (ruled at STOP 1). Every number in it is content's:
  // content/military/strikes.json, battle.json's regen and league-war.json's
  // plunderMultiplier; apps/web/test/guide-war.test.tsx reads them back.
  {
    id: "war",
    title: "War & Raids",
    paragraphs: [
      "Every town and land remembers its raiders. Raid one place more than 10 times in a game year and its people come back at full strength, against the Massalian town or holding beside it where they most outnumber the men standing there. The march is seen 12 hours before it strikes, and every man standing in that place fights it. A raid that gets through takes 2 drachmae for each raider still standing, from the treasury or from the house that holds the place, and a town loses some of its people.",
      "When the chamber votes a war, raids on the enemy pay half as much again, and the League's army may raid and attack them. The enemy marches too: once a season, except in Winter, on the Massalian town or holding beside its land where it most outnumbers the men standing there. A holding it storms is lost.",
      "Garrisons and warbands win back 30% of their full strength each season.",
    ],
  },
  // A reference entry, plain on purpose. Every number in it comes from
  // content/politics/interactions.json (and the poisoned trait); the examples
  // are worked from the same file. apps/web/test/guide-intrigue.test.tsx reads
  // the content and recomputes each of them, so the words cannot drift from it.
  {
    id: "intrigue",
    title: "Poison & Assassination",
    paragraphs: [
      "A citizen with a seat among the Three Hundred can strike at another citizen in two ways: poison and assassination. Both are on the target's profile, which opens from the chamber or the standings.",
    ],
    blocks: [
      { kind: "heading", text: "Who can strike, and at whom" },
      {
        kind: "list",
        items: [
          "You need a seat among the Three Hundred.",
          "The target must be alive and have at least 10 prestige. Below that the action is locked: \"Target lacks standing.\"",
          "You cannot strike at yourself.",
        ],
      },
      {
        kind: "table",
        table: {
          caption: "The two actions",
          columns: ["", "Poison", "Assassination"],
          rows: [
            ["Cost", "1 vial of poison", "200 drachmae"],
            ["If it fails", "The vial is still spent", "The drachmae are still paid"],
            ["If it succeeds", "The target falls ill (6 in 10) or dies (4 in 10)", "The target dies"],
            ["What the target learns", "The illness, if it works. Nothing at all, if it fails", "That a blade was turned aside, if it fails"],
            ["Who struck", "Never told", "Never told"],
          ],
        },
      },
      { kind: "heading", text: "The chance of success" },
      {
        kind: "list",
        items: [
          "Poison starts at 50%. Assassination starts at 45%.",
          "Each point of your Intelligence above the target's defense adds 2.5%. Each point below takes 2.5% away.",
          "The chance is never below 5% and never above 95%.",
          "A spymaster set to Hunt adds 10 to your Intelligence for your own attempts.",
          "A spymaster holds one posture at a time, Guard or Hunt, and can change it once a day.",
          "Intelligence and Militia count with the bonuses and penalties of traits.",
          "You are never shown the chance. The standings rank citizens by Intelligence and Militia but show no numbers, and no one can see another citizen's physician, bodyguards or spymaster.",
        ],
      },
      {
        kind: "table",
        table: {
          caption: "What counts as defense",
          columns: ["", "Against poison", "Against assassination"],
          rows: [
            ["Intelligence", "1 per point", "1 per point"],
            ["Militia", "Nothing", "Half a point per point"],
            ["Physician", "+15", "Nothing"],
            ["Bodyguards", "Nothing", "+12 with one, +18 with two, +21 with three, never above +24"],
            ["Spymaster set to Guard", "+10", "+10"],
          ],
        },
      },
      { kind: "text", text: "Poison and remedies are goods, bought at the Market. Physicians, bodyguards and spymasters are hired there, under People: one physician and one spymaster at most, bodyguards without limit." },
      { kind: "heading", text: "Examples" },
      { kind: "text", text: "In every example the attacker has Intelligence 60 and no spymaster." },
      {
        kind: "table",
        table: {
          caption: "Poison",
          columns: ["Target", "Defense", "Chance", "Falls ill", "Dies"],
          rows: [
            ["Intelligence 35", "35", "95%", "57%", "38%"],
            ["Intelligence 35, physician", "50", "75%", "45%", "30%"],
            ["Intelligence 35, physician, spymaster on Guard", "60", "50%", "30%", "20%"],
            ["Intelligence 55, physician, spymaster on Guard", "80", "5%", "3%", "2%"],
          ],
        },
      },
      {
        kind: "table",
        table: {
          caption: "Assassination",
          columns: ["Target", "Defense", "Chance"],
          rows: [
            ["Intelligence 30, Militia 0", "30", "95%"],
            ["Intelligence 30, Militia 0, two bodyguards", "48", "75%"],
            ["Intelligence 30, Militia 0, two bodyguards, spymaster on Guard", "58", "50%"],
            ["Intelligence 30, Militia 40", "50", "70%"],
            ["Intelligence 30, Militia 80", "70", "20%"],
            ["Intelligence 30, Militia 100", "80", "5%"],
          ],
        },
      },
      { kind: "heading", text: "Afterwards" },
      {
        kind: "list",
        items: [
          "Illness: Militia −3, Intelligence −2 and Prestige −1. It does not pass on its own. The cure needs a physician in your household and spends one remedy.",
          "Death: the house passes to the heir. The death is recorded as a poisoning or a murder, without a name.",
          "The target's chronicle records an illness, a cure and a failed blade, each without a name. A failed poisoning leaves no trace.",
          "The guard: after any attempt, successful or not, nobody can use poison or assassination on that citizen for one year (four days). A refused attempt costs nothing.",
          "The one who struck sees the guard on the target's profile. Everyone else finds out only by trying.",
        ],
      },
    ],
  },
];
