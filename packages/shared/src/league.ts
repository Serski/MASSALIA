export type Alignment = "conservative" | "centrist" | "reformist";


export type Tier = {
  building: string;
  rank: string;
  benefit: string;
  upkeep?: string;
};

export type NarrativeMilestone = {
  milestone: string;
  advance: string;
};

export type Profession = {
  kind: "profession";
  slug: string;
  initial: string;
  image: string;
  name: string;
  rank: string;
  objective: string;
  income: string;
  tiers: Tier[];
  note: string;
  hardMode?: boolean;
  narrativePath?: {
    milestones: NarrativeMilestone[];
    todo: string;
  };
};

export type House = {
  kind: "house";
  slug: string;
  initial: string;
  image: string;
  name: string;
  alignment: Alignment;
  stance: string;
  motto: string;
  patron: string;
  ancestor: string;
  crest: string;
  history: string;
  moment: string;
};

export const professions: Profession[] = [
  {
    kind: "profession",
    slug: "landowner",
    initial: "L",
    image: "assets/LANDLORD copy.png",
    name: "Landowner",
    rank: "@Georgos",
    objective: "Turn fields and estates into the grain engine of your city.",
    income: "2 Wheat/day",
    tiers: [
      { building: "Farm", rank: "@Ktematias", benefit: "4 Wheat/day" },
      { building: "Large Farm", rank: "@Choriarches", benefit: "10 Wheat/day", upkeep: "-10 gold" },
      { building: "Estate", rank: "@Protogeorgos", benefit: "15 Wheat/day" },
      { building: "Large Estate", rank: "@Mega Georgos", benefit: "20 Wheat/day", upkeep: "-25 gold" },
    ],
    note: "All professions cost 100 gold to start. Wheat is roughly 10 gold/unit; Landowners can use the Forge.",
  },
  {
    kind: "profession",
    slug: "trader",
    initial: "T",
    image: "assets/TRADER copy.png",
    name: "Trader",
    rank: "@Emporos",
    objective: "Move wine, rare resources, and influence across the Mediterranean routes.",
    income: "2 Wine/day",
    tiers: [
      { building: "Trade Post", rank: "@Nautilos Emporos", benefit: "4 Wine/day" },
      { building: "Large Trade Post", rank: "@Emporikos Presbeutes", benefit: "10 Wine/day", upkeep: "-10 gold" },
      { building: "Trading Hub", rank: "@Emporos Archon", benefit: "15 Wine/day" },
      { building: "Trade Port", rank: "@Emporos Mega", benefit: "20 Wine/day", upkeep: "-25 gold" },
    ],
    note: "All professions cost 100 gold to start. Wine is roughly 15 gold/unit; trade ports unlock rare resources.",
  },
  {
    kind: "profession",
    slug: "priest",
    initial: "P",
    image: "assets/PRIEST copy.png",
    name: "Priest",
    rank: "@Neokoros",
    objective: "Convert devotion, healing, and ritual authority into civic power.",
    income: "2 Herbal/day +5 Devotion",
    tiers: [
      { building: "Shrine", rank: "@Mystes", benefit: "4 Herbal/day; +5 Devotion" },
      { building: "Temple", rank: "@Hierophant", benefit: "10 Herbal/day; +10 Devotion" },
      { building: "Sanctuary", rank: "@Archiereus", benefit: "15 Herbal/day; +15 Devotion" },
      { building: "Grand Sanctuary", rank: "@Mega Archiereus", benefit: "20 Herbal/day; +20 Devotion" },
    ],
    note: "All professions cost 100 gold to start. Herbal is roughly 20 gold/unit; Priests train Healers. One Healer restores 10 troops.",
  },
  {
    kind: "profession",
    slug: "philosopher",
    initial: "F",
    image: "assets/PHILOSOPHER copy.png",
    name: "Philosopher",
    rank: "@Didaskalos",
    objective: "Build schools, prestige, and diplomatic leverage through learning.",
    income: "10 gold/day +5 Prestige",
    tiers: [
      { building: "School", rank: "@Scholarch", benefit: "20 gold/day; +5 Prestige" },
      { building: "Academy", rank: "@Philosophos", benefit: "30 gold/day; +10 Prestige" },
      { building: "Lyceum", rank: "@Sophistes", benefit: "40 gold/day; +20 Prestige" },
      { building: "Great Lyceum", rank: "@Megasophistes", benefit: "50 gold/day; +30 Prestige" },
    ],
    note: "All professions cost 100 gold to start. Philosophers craft prestige items through the Cloth Factory and gain +10% diplomatic missions.",
  },
  {
    kind: "profession",
    slug: "shipbuilder",
    initial: "S",
    image: "assets/SHIP BUILDER copy.png",
    name: "Shipbuilder",
    rank: "@Naupegos",
    objective: "Own the dockyards that decide who can trade, raid, and cross the sea.",
    income: "10 gold/day",
    tiers: [
      { building: "Shipyard", rank: "@Naukleros", benefit: "20 gold/day" },
      { building: "Naval Dock", rank: "@Epimeletes", benefit: "30 gold/day" },
      { building: "Shipwright Complex", rank: "@Ship Architekton", benefit: "40 gold/day" },
      { building: "Grand Naval Facility", rank: "@Mega Naupegos", benefit: "50 gold/day" },
    ],
    note: "All professions cost 100 gold to start. Shipbuilders craft naval supplies, sailors, and ships, and research new ship types.",
  },
  {
    kind: "profession",
    slug: "hetaira",
    initial: "H",
    image: "assets/HETAIRA copy.png",
    name: "Hetaira",
    rank: "@Hetaira",
    objective: "Turn salons, gossip, and dangerous favors into quiet political force.",
    income: "20 gold/day +5 Intelligence",
    tiers: [
      { building: "Salon", rank: "@Desmoteros", benefit: "30 gold/day; +10 Intelligence" },
      { building: "Courtesan House", rank: "@Pallake", benefit: "40 gold/day; +15 Intelligence" },
      { building: "Luxury Villa", rank: "@Hetairarches", benefit: "50 gold/day; +20 Intelligence; +5% intelligence" },
      { building: "Grand Villa", rank: "@Megalhetaira", benefit: "60 gold/day; +25 Intelligence; +10% intelligence" },
    ],
    note: "All professions cost 100 gold to start. Hetairai craft poisons and gossip spreaders, train Healers, and use the Cloth Factory.",
  },
  {
    kind: "profession",
    slug: "military-leader",
    initial: "M",
    image: "assets/HOPLITE copy.png",
    name: "Military Leader",
    rank: "@Dekarchos",
    objective: "Command citizen soldiers and grow from local captain to League warlord.",
    income: "20 gold/day +5 Militia; leads 10 troops",
    tiers: [
      { building: "Enhanced Training", rank: "@Ekatontarchos", benefit: "30 gold/day; +10 Militia; leads 100 troops" },
      { building: "Advanced Training Facility", rank: "@Lochagos", benefit: "40 gold/day; +15 Militia; leads 250 troops" },
      { building: "Fortified Barracks", rank: "@Taxiarchos", benefit: "50 gold/day; +20 Militia; leads 750 troops" },
      { building: "Citadel Command Center", rank: "@Xiliarchos", benefit: "60 gold/day; +25 Militia; leads 1000 troops" },
    ],
    note: "All professions cost 100 gold to start. Military Leaders craft military traits with wine and papyrus and can use the Forge.",
  },
  {
    kind: "profession",
    slug: "slave",
    initial: "S",
    image: "assets/SLAVE.png",
    name: "Slave",
    rank: "@Doulos",
    objective: "Hard mode. Begin at the very bottom of Massalian society with nothing to your name: no land, no coin, no House. Endure, scrape together a peculium, and earn your freedom through the story, then rise into any profession you choose.",
    income: "0 gold/day · earn your freedom",
    tiers: [],
    note: "Solo hard-mode start. No other player commands this path; freedom is earned through narrative progression.",
    hardMode: true,
    narrativePath: {
      milestones: [
        { milestone: "Bound", advance: "Survive the opening story and learn who holds power around you." },
        { milestone: "Laboring", advance: "Take low-status work, gather favors, and avoid debt traps." },
        { milestone: "Peculium", advance: "Build permitted savings through story choices and small opportunities." },
        { milestone: "Manumitted", advance: "Secure freedom through the narrative arc and become a freedman." },
        { milestone: "Free Citizen", advance: "Choose any profession and begin a normal ladder from the bottom." },
      ],
      todo: "TODO: Final milestone requirements and numeric thresholds are not designed yet.",
    },
  },
];

export const nobleHouses: House[] = [
  { kind: "house", slug: "kleitos", initial: "K", image: "assets/Kleitos.png", name: "Kleitos", alignment: "reformist", stance: "Reformist", motto: "Unity in diversity strengthens us.", patron: "Hestia", ancestor: "Agathon Kleitos, 580-517 BC", crest: "Dove with olive branch", history: "Pushed Gaulish integration and a broader League identity.", moment: "Brokered the Accord of Liris in 560 BC." },
  { kind: "house", slug: "miltiades", initial: "M", image: "assets/Mitliades.png", name: "Miltiades", alignment: "reformist", stance: "Mod. Reformist", motto: "Understanding is the foundation of peace.", patron: "Asclepius", ancestor: "Cleisthenes Miltiades, 570-509 BC", crest: "Scroll with Greek and Gaulish symbols", history: "Built its name through diplomacy, interpreters, and patient civic education.", moment: "Founded the first bilingual school around 530 BC." },
  { kind: "house", slug: "xanthippos", initial: "X", image: "assets/Xanthipos.png", name: "Xanthippos", alignment: "centrist", stance: "Centrist", motto: "Harmony through balance.", patron: "Iris", ancestor: "Damon Xanthippos, 550-492 BC", crest: "Scale with helmet and torque", history: "Mediator family trusted by merchants, soldiers, Greeks, and Gauls.", moment: "Secured the Treaty of Metron in 490 BC." },
  { kind: "house", slug: "iason", initial: "I", image: "assets/Iason.png", name: "Iason", alignment: "conservative", stance: "Centrist to Conservative", motto: "Navigate the old, embrace the new.", patron: "Proteus", ancestor: "Periander Iason, 530-475 BC", crest: "Galley with oars", history: "Sea-facing house that keeps old forms while testing foreign routes.", moment: "Led the Iberian trade expedition in 450 BC." },
  { kind: "house", slug: "timon", initial: "T", image: "assets/Timon.png", name: "Timon", alignment: "conservative", stance: "Conservative", motto: "Preserve the arts, sustain the soul.", patron: "Erato", ancestor: "Theodorus Timon, 560-491 BC", crest: "Greek lyre", history: "Patrons of festivals, poetry, and old Hellenic rites.", moment: "Held the first festival to the Greek gods in 420 BC." },
  { kind: "house", slug: "aristeides", initial: "A", image: "assets/Aristeides.png", name: "Aristeides", alignment: "centrist", stance: "Centrist", motto: "Defend and respect all borders.", patron: "Nike", ancestor: "Leon Aristeides, 540-478 BC", crest: "Shield and crossed spear", history: "Border defenders who value discipline more than factional purity.", moment: "Distinguished itself at the Battle of the Rhone in 460 BC." },
  { kind: "house", slug: "herakleides", initial: "H", image: "assets/Herakleides.png", name: "Herakleides", alignment: "conservative", stance: "Mod. Conservative", motto: "Justice adapts, principles endure.", patron: "Themis", ancestor: "Myron Herakleides, 560-512 BC", crest: "Stone tablet and stylus", history: "Legalist house that guards old institutions while accepting measured reforms.", moment: "Revised the legal code in 480 BC." },
  { kind: "house", slug: "nicanor", initial: "N", image: "assets/Nicanor.png", name: "Nicanor", alignment: "reformist", stance: "Mod. Reformist", motto: "Through the seas, we find our stars.", patron: "Tyche", ancestor: "Eumenes Nicanor, 520-481 BC", crest: "Celestial sphere", history: "Navigators, chance-takers, and long-distance traders.", moment: "Reached Britannia by the stars in 510 BC." },
  { kind: "house", slug: "philon", initial: "P", image: "assets/Philon.png", name: "Philon", alignment: "reformist", stance: "Reformist to Centrist", motto: "Healing hands, merging wisdom.", patron: "Panacea", ancestor: "Chrysippus Philon, 550-492 BC", crest: "Serpent on staff", history: "Medical house blending Greek technique with Gaulish herbal knowledge.", moment: "Opened the first Greek and Gaulish clinic around 550 BC." },
  { kind: "house", slug: "leonidas", initial: "L", image: "assets/Leonidas.png", name: "Leonidas", alignment: "conservative", stance: "Very Conservative", motto: "In tradition, we trust.", patron: "Aeolus", ancestor: "Alexandros Leonidas, 600-528 BC", crest: "Roaring lion", history: "Old aristocratic house committed to pure Hellenic continuity.", moment: "Built the temple of Apollo in 600 BC." },
];
