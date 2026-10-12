// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseView } from "../src/api.js";
import { mapActionButtons, withHolder } from "../src/map/mapActions.js";
import { holderLine, regionFlipHolder, TownPanel, townHeldSuffix, type HoldingHolder } from "../src/map/World2Map.js";

// ---------------------------------------------------------------------------
// Holdings prompt 1: who holds a conquered place is public. The pure rules
// (the region flip, the holder lines, the Attack grey-out) and the town panel
// rendered on its own: another house's town reads its holder, carries
// Massalia's crest and greys Attack with the server's sentence; the viewer's
// own town reads the tribute line as before. The mounted map is covered in
// world2map-cards.test.tsx.
// ---------------------------------------------------------------------------

afterEach(() => cleanup());

const konrad: HoldingHolder = { playerId: "p-konrad", characterName: "Konrad Curze", houseName: "Leonidas" };
const damon: HoldingHolder = { playerId: "p-damon", characterName: "Damon Leontios", houseName: "Kleitos" };
const nameless: HoldingHolder = { playerId: "p-x", characterName: "Xenos", houseName: null };

describe("the region flip rule (ruling 2a)", () => {
  it("two towns with one held does not flip; both held by one house flips to that house", () => {
    expect(regionFlipHolder(["reii", "album"], { reii: konrad })).toBeNull();
    expect(regionFlipHolder(["reii", "album"], { reii: konrad, album: konrad })).toEqual(konrad);
  });
  it("one town held by each of two houses does not flip", () => {
    expect(regionFlipHolder(["reii", "album"], { reii: konrad, album: damon })).toBeNull();
  });
  it("a region with no towns is untouched; a region with one town, held, flips", () => {
    expect(regionFlipHolder([], { reii: konrad })).toBeNull();
    expect(regionFlipHolder(["reii"], { reii: konrad })).toEqual(konrad);
  });
});

describe("the holder lines and the Attack grey-out", () => {
  it("reads the house and the character, or the character alone without a house", () => {
    expect(holderLine(konrad)).toBe("Held by House Leonidas · Konrad Curze");
    expect(holderLine(nameless)).toBe("Held by Xenos");
    expect(townHeldSuffix(konrad, false)).toBe(" · held by House Leonidas");
    expect(townHeldSuffix(nameless, false)).toBe(" · held by Xenos");
    expect(townHeldSuffix(konrad, true)).toBe(" · held by your house");
    expect(townHeldSuffix(null, false)).toBe("");
  });
  it("withHolder greys Attack alone with the sentence, keeps the rest, and is a no-op without a sentence", () => {
    const row = { buttons: mapActionButtons({ kind: "town", hasTown: true, ownerId: "saluvii" }), caption: null };
    expect(withHolder(row, null)).toBe(row);
    const greyed = withHolder(row, "Another house holds this town.");
    const by = (type: string) => greyed.buttons.find((b) => b.type === type)!;
    expect(by("attack")).toMatchObject({ enabled: false, title: "Another house holds this town." });
    expect(by("raid").enabled).toBe(true);
    expect(by("scout").enabled).toBe(true);
    expect(greyed.caption).toBe("Another house holds this town.");
    // A caption the reach already set is kept.
    expect(withHolder({ ...row, caption: "Out of reach" }, "Another house holds this town.").caption).toBe("Out of reach");
  });
});

describe("TownPanel on a held town", () => {
  const panel = (held: BaseView | null, holder: HoldingHolder | null) => {
    const actions = withHolder({ buttons: mapActionButtons({ kind: "town", hasTown: true, ownerId: "saluvii" }), caption: null }, holder ? "Another house holds this town." : null);
    return render(
      <TownPanel
        town={{ id: "reii", name: "Reii" }}
        regionName="Vocontii"
        stateName="Massalia"
        ownerId="massalia"
        color="#e0a33c"
        stats={{ population: 1500, walls: 1 }}
        mil={undefined}
        held={held}
        holder={holder}
        yourMen={null}
        actions={actions}
        canSendMen={false}
        isMobile={false}
        onClose={() => {}}
        onBack={() => {}}
        onAction={() => {}}
        onSendMen={() => {}}
      />,
    );
  };

  it("another house's town: the holder line, Massalia's crest, Attack greyed with the sentence, Raid and Scout live", () => {
    const { container } = panel(null, konrad);
    expect(container.querySelector(".w2map-held")!.textContent).toBe("Held by House Leonidas · Konrad Curze");
    expect(container.querySelector(".w2map-region-name")!.textContent).toBe("Massalia · Vocontii");
    const crest = container.querySelector("img.w2map-crest") as HTMLImageElement;
    expect(crest).not.toBeNull();
    expect(crest.getAttribute("src")).toContain("MASSALIA");
    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".w2map-action")];
    const by = (label: string) => buttons.find((b) => b.textContent === label)!;
    expect(by("Attack").disabled).toBe(true);
    expect(by("Attack").getAttribute("title")).toBe("Another house holds this town.");
    expect(by("Raid").disabled).toBe(false);
    expect(by("Scout").disabled).toBe(false);
    expect(container.textContent).not.toContain("Massalia does not act against her own");
  });

  it("the viewer's own town reads the tribute line, and no holder line", () => {
    const mine: BaseView = { id: "reii", regionId: "R047", townId: "reii", kind: "conquest", name: "Reii", holding: { garrison: 47, minGarrison: 15, perDay: { drachmae: 120, grain: 0, timber: 0 }, levyPerYear: 0 } };
    const { container } = panel(mine, null);
    const lines = [...container.querySelectorAll(".w2map-held")].map((p) => p.textContent);
    expect(lines).toEqual(["Held by your house · tribute 120 dr a day"]);
  });
});
