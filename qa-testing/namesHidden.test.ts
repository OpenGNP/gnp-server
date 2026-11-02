import { describe, expect, it } from "bun:test";
import { namesHiddenFor } from "../src/services/formAccess";

describe("namesHiddenFor", () => {
  const form = (showNamesToViewers: boolean) => ({ adminId: 1, showNamesToViewers });

  it("never hides names from the owner", () => {
    expect(namesHiddenFor(form(false), 1)).toBe(false);
  });

  it("hides names from viewers by default", () => {
    expect(namesHiddenFor(form(false), 2)).toBe(true);
  });

  it("shows names to viewers once the owner allows it", () => {
    expect(namesHiddenFor(form(true), 2)).toBe(false);
  });
});
