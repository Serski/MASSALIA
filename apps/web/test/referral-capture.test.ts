// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api.js";
import { REFERRAL_KEY, captureReferralFromUrl, clearStoredReferral, storedReferral } from "../src/referral.js";

// ---------------------------------------------------------------------------
// The invite promo on the client: an invite link's code is kept until sign-up
// (never for a visitor who already has an account), the parameter leaves the
// address bar at once, and api.register sends the stored code and clears it
// only after a successful sign-up.
// ---------------------------------------------------------------------------

const address = () => `${window.location.pathname}${window.location.search}`;
const visit = (url: string) => window.history.replaceState(null, "", url);

beforeEach(() => {
  localStorage.clear();
  visit("/");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("captureReferralFromUrl", () => {
  it("stores a well-formed code upper-cased and takes the parameter off the address", () => {
    visit("/?invite=abcdef1234");
    captureReferralFromUrl(false);
    expect(localStorage.getItem(REFERRAL_KEY)).toBe("ABCDEF1234");
    expect(storedReferral()).toBe("ABCDEF1234");
    expect(address()).toBe("/");
  });

  it("stores nothing for a visitor with a session, but still removes the parameter", () => {
    visit("/?invite=abcdef1234");
    captureReferralFromUrl(true);
    expect(localStorage.getItem(REFERRAL_KEY)).toBeNull();
    expect(address()).toBe("/");
  });

  it("ignores a malformed code, and keeps the other parameters", () => {
    visit("/?invite=xyz");
    captureReferralFromUrl(false);
    expect(localStorage.getItem(REFERRAL_KEY)).toBeNull();
    expect(address()).toBe("/");

    visit("/?page=terms&invite=ABCDEF1234");
    captureReferralFromUrl(false);
    expect(storedReferral()).toBe("ABCDEF1234");
    expect(address()).toBe("/?page=terms");
  });

  it("a stored value that fails the pattern reads as null", () => {
    localStorage.setItem(REFERRAL_KEY, "nope");
    expect(storedReferral()).toBeNull();
    clearStoredReferral();
    expect(localStorage.getItem(REFERRAL_KEY)).toBeNull();
  });
});

describe("api.register", () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string) as Record<string, unknown>;

  it("sends a stored code and clears it after a 200", async () => {
    localStorage.setItem(REFERRAL_KEY, "ABCDEF1234");
    const fetchMock = vi.fn().mockResolvedValue(json(200, { user: { id: "u", email: "a@t" }, hasCharacter: false }));
    vi.stubGlobal("fetch", fetchMock);
    await api.register("a@t", "correct-horse", false, true);
    expect(bodyOf(fetchMock)).toMatchObject({ email: "a@t", referralCode: "ABCDEF1234", termsAccepted: true });
    expect(localStorage.getItem(REFERRAL_KEY)).toBeNull();
  });

  it("keeps the code after a refused sign-up", async () => {
    localStorage.setItem(REFERRAL_KEY, "ABCDEF1234");
    const fetchMock = vi.fn().mockResolvedValue(json(409, { error: "Email is already registered." }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.register("a@t", "correct-horse", false, true)).rejects.toThrow("Email is already registered.");
    expect(bodyOf(fetchMock)).toMatchObject({ referralCode: "ABCDEF1234" });
    expect(localStorage.getItem(REFERRAL_KEY)).toBe("ABCDEF1234");
  });

  it("sends no referralCode when nothing is stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { user: { id: "u", email: "a@t" }, hasCharacter: false }));
    vi.stubGlobal("fetch", fetchMock);
    await api.register("a@t", "correct-horse", false, true);
    expect(Object.keys(bodyOf(fetchMock)).sort()).toEqual(["email", "newsletterOptIn", "password", "termsAccepted"]);
  });
});
