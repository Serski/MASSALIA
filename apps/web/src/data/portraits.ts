import { assetPath } from "./league.js";

export type PortraitOption = {
  id: string;
  label: string;
  image: string;
  placeholder?: boolean;
};

const portraitSlots = ["1", "2", "3", "4", "5", "6"] as const;

const portraitClassSlugs = [
  "landowner",
  "trader",
  "priest",
  "philosopher",
  "shipbuilder",
  "hetaira",
  "hoplite",
  "slave",
] as const;

export type PortraitClassSlug = (typeof portraitClassSlugs)[number];

const portraitPrefixes: Record<PortraitClassSlug, string> = {
  landowner: "LA",
  trader: "TR",
  priest: "PR",
  philosopher: "PH",
  shipbuilder: "SB",
  hetaira: "HE",
  hoplite: "ML",
  slave: "SL",
};

// Which portrait slots (1-6) have real uploaded art per class — all stored as
// webp. Slots not listed here stay placeholders: the dashboard avatar and the
// creation picker fall back to the class icon/label instead of a broken image,
// until that art lands. The five fully-illustrated classes list all six.
const uploadedSlots: Partial<Record<PortraitClassSlug, number[]>> = {
  landowner: [1, 2, 3, 4, 5, 6],
  trader: [1, 2, 3, 4, 5, 6],
  priest: [1, 2, 3, 4, 5, 6],
  shipbuilder: [1, 2, 3, 4, 5, 6],
  hoplite: [1, 2, 3, 4, 5, 6],
  philosopher: [1],
  hetaira: [1, 2, 3, 4],
  slave: [1],
};

export const portraitPools: Record<PortraitClassSlug, PortraitOption[]> = Object.fromEntries(
  portraitClassSlugs.map((classSlug) => {
    const prefix = portraitPrefixes[classSlug];
    const realSlots = uploadedSlots[classSlug] ?? [];
    return [
      classSlug,
      portraitSlots.map((slot) => ({
        id: `${classSlug}-${prefix}${slot}`,
        label: `${classSlug.replace("-", " ")} ${slot}`,
        image: assetPath(`assets/portraits/${classSlug}/${prefix}${slot}.webp`),
        placeholder: !realSlots.includes(Number(slot)),
      })),
    ];
  }),
) as Record<PortraitClassSlug, PortraitOption[]>;
