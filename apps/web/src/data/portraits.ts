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
  "military-leader",
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
  "military-leader": "ML",
  slave: "SL",
};

const uploadedPortraits: Partial<Record<PortraitClassSlug, string>> = {
  trader: "webp",
};

export const portraitPools: Record<PortraitClassSlug, PortraitOption[]> = Object.fromEntries(
  portraitClassSlugs.map((classSlug) => {
    const prefix = portraitPrefixes[classSlug];
    const extension = uploadedPortraits[classSlug] ?? "webp";
    return [
      classSlug,
      portraitSlots.map((slot) => ({
        id: `${classSlug}-${prefix}${slot}`,
        label: `${classSlug.replace("-", " ")} ${slot}`,
        image: assetPath(`assets/portraits/${classSlug}/${prefix}${slot}.${extension}`),
        placeholder: !uploadedPortraits[classSlug],
      })),
    ];
  }),
) as Record<PortraitClassSlug, PortraitOption[]>;
