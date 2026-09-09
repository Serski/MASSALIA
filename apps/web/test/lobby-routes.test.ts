import { describe, expect, it } from "vitest";
import { lobbyViewFor } from "../src/lobby/routes.js";

// The lobby's pathname → view mapping, with and without a trailing slash.
describe("lobbyViewFor", () => {
  it("maps the lobby front, with or without a trailing slash", () => {
    expect(lobbyViewFor("/lobby")).toBe("worlds");
    expect(lobbyViewFor("/lobby/")).toBe("worlds");
  });

  it("maps the account view", () => {
    expect(lobbyViewFor("/lobby/account")).toBe("account");
    expect(lobbyViewFor("/lobby/account/")).toBe("account");
  });

  it("maps the hall of fame view", () => {
    expect(lobbyViewFor("/lobby/hall-of-fame")).toBe("hall-of-fame");
    expect(lobbyViewFor("/lobby/hall-of-fame/")).toBe("hall-of-fame");
  });

  it("returns null for anything else", () => {
    expect(lobbyViewFor("/")).toBeNull();
    expect(lobbyViewFor("/lobbyx")).toBeNull();
    expect(lobbyViewFor("/lobby/other")).toBeNull();
    expect(lobbyViewFor("/game")).toBeNull();
  });
});
