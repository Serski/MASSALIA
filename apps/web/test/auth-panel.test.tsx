// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AuthPanel } from "../src/App.js";

// The pottery card (auth prompt 1): a meander band above and below the card, the
// tabs and the close button inside it, no rods, finials, corners or field glyphs.
// The panel calls nothing on mount, so nothing here needs an API mock.
afterEach(cleanup);

const noop = () => {};

describe("auth panel", () => {
  it("login mode: the card holds the tabs and the close button, and the ornaments are gone", () => {
    render(<AuthPanel mode="login" onModeChange={noop} onClose={noop} isModal />);

    expect(document.querySelector(".auth-rod")).toBeNull();
    expect(document.querySelector(".auth-finial")).toBeNull();
    expect(document.querySelector(".auth-corner")).toBeNull();
    expect(document.querySelectorAll(".auth-meander").length).toBe(2);

    const toggle = document.querySelector(".auth-card .auth-tab-toggle")!;
    expect(toggle).not.toBeNull();
    expect(toggle.querySelector("button")!.className).toContain("active");

    expect(document.querySelector("h1#auth-title")!.textContent).toBe("Enter the League");
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.querySelector('input[type="password"]')).not.toBeNull();
    expect(document.querySelector(".auth-form i")).toBeNull();

    expect(document.querySelector(".auth-submit")!.textContent).toBe("Log in");
    expect(document.querySelector("button.auth-forgot")).not.toBeNull();
    expect(document.querySelector(".auth-switch button")!.textContent!.startsWith("Found your legacy")).toBe(true);
    expect(document.querySelectorAll(".auth-legal-links a").length).toBe(2);
    expect(document.querySelector(".auth-close")).not.toBeNull();
  });

  it("signup mode: the submit stays disabled until the terms are accepted", () => {
    render(<AuthPanel mode="signup" onModeChange={noop} onClose={noop} isModal />);

    expect(document.querySelector("h1#auth-title")!.textContent).toBe("Join the League");
    const checks = document.querySelectorAll<HTMLInputElement>('.auth-checks input[type="checkbox"]');
    expect(checks.length).toBe(2);

    const submit = document.querySelector<HTMLButtonElement>(".auth-submit")!;
    expect(submit.textContent).toBe("Sign up & play free");
    expect(submit.disabled).toBe(true);

    fireEvent.click(checks[1]!);
    expect(submit.disabled).toBe(false);
  });
});
