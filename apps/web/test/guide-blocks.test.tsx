// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuideBlocks } from "../src/dashboard/GuideBlocks.js";
import type { GuideBlock } from "../src/dashboard/guideContent.js";

// ---------------------------------------------------------------------------
// GuideBlocks: the richer blocks a Guide section may carry after its paragraphs
// (headings, plain lines, lists, tables), rendered the same way in the in-game
// Guide sheet and on the public /guides page. The surface passes its own
// paragraph class, so type and color stay the surface's.
// ---------------------------------------------------------------------------

afterEach(cleanup);

const BLOCKS: GuideBlock[] = [
  { kind: "heading", text: "A heading" },
  { kind: "text", text: "A plain line." },
  { kind: "list", items: ["One", "Two"] },
  { kind: "table", table: { caption: "A table", columns: ["", "Left", "Right"], rows: [["First", "a", "b"], ["Second", "c", "d"]] } },
];

describe("GuideBlocks", () => {
  it("renders nothing for a section without blocks", () => {
    expect(render(<GuideBlocks blocks={undefined} textClass="guide-p" />).container.innerHTML).toBe("");
    cleanup();
    expect(render(<GuideBlocks blocks={[]} textClass="guide-p" />).container.innerHTML).toBe("");
  });

  it("renders a heading, a line, a list and a table in order, under the surface's paragraph class", () => {
    const { container } = render(<GuideBlocks blocks={BLOCKS} textClass="lobby-guide-p" />);
    const wrapper = container.querySelector(".guide-blocks")!;
    expect(wrapper.className).toBe("guide-blocks lobby-guide-p");
    expect([...wrapper.children].map((el) => el.tagName)).toEqual(["H4", "P", "UL", "DIV"]);
    expect(wrapper.querySelector("h4.guide-block-h")!.textContent).toBe("A heading");
    expect(wrapper.querySelector("p")!.textContent).toBe("A plain line.");
    expect([...wrapper.querySelectorAll("ul.guide-block-list > li")].map((li) => li.textContent)).toEqual(["One", "Two"]);
  });

  it("a table has its caption, a head row and a row header on each row, inside its own scrolling box", () => {
    const { container } = render(<GuideBlocks blocks={BLOCKS} textClass="guide-p" />);
    const table = container.querySelector(".guide-table-wrap > table.guide-table")!;
    expect(table.querySelector("caption")!.textContent).toBe("A table");
    expect([...table.querySelectorAll("thead th")].map((th) => [th.textContent, th.getAttribute("scope")])).toEqual([["", "col"], ["Left", "col"], ["Right", "col"]]);
    expect([...table.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => `${c.tagName}:${c.textContent}`))).toEqual([
      ["TH:First", "TD:a", "TD:b"],
      ["TH:Second", "TD:c", "TD:d"],
    ]);
    expect([...table.querySelectorAll("tbody th")].every((th) => th.getAttribute("scope") === "row")).toBe(true);
  });

  it("the stylesheet lets a wide table scroll in its own box, never the page", () => {
    const css = readFileSync(resolve(process.cwd(), "src/dashboard/guideBlocks.css"), "utf8");
    expect(css).toMatch(/\.guide-table-wrap \{[^}]*overflow-x: auto;/);
    expect(css).toMatch(/\.guide-table \{[^}]*width: 100%;/);
  });
});
