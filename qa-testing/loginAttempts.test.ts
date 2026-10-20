import { describe, expect, it } from "bun:test";

import { clearLoginFailures, lockedForMinutes, recordLoginFailure } from "../src/lib/loginAttempts";

describe("loginAttempts", () => {
  it("locks an email after 5 failures for the rest of the 15-minute window", () => {
    const start = 1_000_000;
    for (let i = 0; i < 4; i++) recordLoginFailure("A@x.com", start);
    expect(lockedForMinutes("a@x.com", start)).toBe(0);
    recordLoginFailure("a@x.com", start);
    expect(lockedForMinutes("a@x.com", start + 60_000)).toBe(14);
    expect(lockedForMinutes("a@x.com", start + 15 * 60_000)).toBe(0);
  });

  it("starts over after a successful sign-in", () => {
    for (let i = 0; i < 5; i++) recordLoginFailure("b@x.com");
    clearLoginFailures("B@x.com");
    expect(lockedForMinutes("b@x.com")).toBe(0);
  });
});
