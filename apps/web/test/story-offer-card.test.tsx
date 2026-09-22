// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webAssetUrl, type PlayerState } from "../src/api.js";
import { StoryOfferCard } from "../src/dashboard/panels/CourtPanel.js";

// The Court's story offer card (House of Roses prompt 1): the start node's art
// rides above the title when the server sends one, and the button words itself
// by the offer's status. The card calls nothing on mount.
afterEach(cleanup);

type Story = PlayerState["stories"][number];
const story = (over: Partial<Story> = {}): Story => ({ storyId: "house-of-roses", status: "offered", title: "The House of Roses", ...over });

describe("story offer card", () => {
  it("renders the cover art as the card's banner", () => {
    render(<StoryOfferCard story={story({ image: "/stories/story-roses-00-opening.webp" })} onOpen={() => {}} />);

    const banner = document.querySelector<HTMLElement>(".panel-banner")!;
    expect(banner).not.toBeNull();
    expect(banner.style.backgroundImage).toContain(webAssetUrl("/stories/story-roses-00-opening.webp")!);
    expect(document.querySelector("h3")!.textContent).toBe("The House of Roses");
  });

  it("renders no banner when the story has no cover art", () => {
    render(<StoryOfferCard story={story()} onOpen={() => {}} />);
    expect(document.querySelector(".panel-banner")).toBeNull();
  });

  it("reads Begin for an offer and Continue for a run in flight, and opens on a click", () => {
    const onOpen = vi.fn();
    const { unmount } = render(<StoryOfferCard story={story()} onOpen={onOpen} />);
    const begin = document.querySelector<HTMLButtonElement>(".event-choice-button")!;
    expect(begin.textContent).toBe("Begin");
    fireEvent.click(begin);
    expect(onOpen).toHaveBeenCalledTimes(1);
    unmount();

    render(<StoryOfferCard story={story({ status: "active" })} onOpen={() => {}} />);
    expect(document.querySelector(".event-choice-button")!.textContent).toBe("Continue");
  });
});
