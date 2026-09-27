import { describe, expect, it } from "bun:test";
import { anonymousIdentityCode, createId } from "../src/utils/helper";

describe("createId", () => {
  it("prefixes a UUID", () => {
    const id = createId("form");
    expect(id.startsWith("form_")).toBe(true);
    expect(id).toMatch(/^form_[0-9a-f-]{36}$/);
  });

  it("produces distinct ids on each call", () => {
    expect(createId("form")).not.toBe(createId("form"));
  });

  it("handles an empty prefix without throwing", () => {
    const id = createId("");
    expect(id).toMatch(/^_[0-9a-f-]{36}$/);
  });

  it("does not sanitize the prefix — it's inserted literally", () => {
    // Documents current behavior rather than asserting a "should": callers
    // are trusted to pass a safe, static prefix (e.g. "form", "resp"),
    // never unsanitized user input.
    const id = createId("weird prefix/with:chars");
    expect(id.startsWith("weird prefix/with:chars_")).toBe(true);
  });
});

describe("anonymousIdentityCode", () => {
  it("is deterministic for the same (formId, identity) pair", () => {
    const a = anonymousIdentityCode(1, "user-42");
    const b = anonymousIdentityCode(1, "user-42");
    expect(a).toBe(b);
  });

  it("differs across forms for the same identity", () => {
    const a = anonymousIdentityCode(1, "user-42");
    const b = anonymousIdentityCode(2, "user-42");
    expect(a).not.toBe(b);
  });

  it("differs across identities on the same form", () => {
    const a = anonymousIdentityCode(1, "user-42");
    const b = anonymousIdentityCode(1, "device-abc");
    expect(a).not.toBe(b);
  });

  it("is prefixed and does not leak the raw identity", () => {
    const code = anonymousIdentityCode(1, "user-42");
    expect(code.startsWith("resp_")).toBe(true);
    expect(code).not.toContain("user-42");
  });

  it("is always resp_ followed by a 64-char lowercase hex sha256 digest", () => {
    const code = anonymousIdentityCode(1, "user-42");
    expect(code).toMatch(/^resp_[0-9a-f]{64}$/);
  });

  it("handles formId 0 as a real value, not as 'missing'", () => {
    const zero = anonymousIdentityCode(0, "user-42");
    const one = anonymousIdentityCode(1, "user-42");
    expect(zero).toMatch(/^resp_[0-9a-f]{64}$/);
    expect(zero).not.toBe(one);
  });

  it("handles an empty identity string without throwing", () => {
    expect(anonymousIdentityCode(1, "")).toMatch(/^resp_[0-9a-f]{64}$/);
  });

  it("does not normalize whitespace — differently-padded identities are treated as different people", () => {
    const a = anonymousIdentityCode(1, "user-42");
    const b = anonymousIdentityCode(1, "user-42 ");
    expect(a).not.toBe(b);
  });

  it("handles unicode identities without throwing", () => {
    expect(anonymousIdentityCode(1, "用户-42")).toMatch(/^resp_[0-9a-f]{64}$/);
  });

  it("has no delimiter ambiguity: adjacent-digit formId/identity splits still produce distinct codes", () => {
    // formId=1, identity="23:x" and formId=12, identity="3:x" both concatenate
    // around a ":" near the form/identity boundary — confirms the (formId, identity)
    // pair, not just the raw concatenated string, determines the code.
    const a = anonymousIdentityCode(1, "23:x");
    const b = anonymousIdentityCode(12, "3:x");
    expect(a).not.toBe(b);
  });
});
