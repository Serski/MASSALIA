// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";

// The front page is the hero, the atlas and the closing CTA. With no session hint
// `/` renders the landing synchronously, so nothing here needs an API mock.
afterEach(cleanup);

describe("landing page", () => {
  it("keeps the hero, the atlas and the CTA, and none of the removed sections", () => {
    window.history.replaceState({}, "", "/");
    const view = render(<App />);

    expect(document.querySelector("h1")!.textContent).toBe("Massalia");
    expect(view.getAllByRole("button", { name: "Start The Game" }).length).toBeGreaterThan(0);
    expect(view.getByRole("heading", { name: "Massalia and the Phocaean world" })).toBeTruthy();

    expect(view.queryByText("Three choices that shape your game")).toBeNull();
    expect(view.queryByText("Eight paths to power")).toBeNull();
    expect(view.queryByText("The seats of government")).toBeNull();
    expect(view.queryByText("Tradition, or reform?")).toBeNull();
    expect(view.queryByText("Ten Noble Houses")).toBeNull();

    expect(document.querySelector("img.hero-lion")).toBeNull();
    expect(document.querySelector(".nav-primary-links")).toBeNull();
  });
});
