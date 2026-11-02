import { describe, expect, it } from "bun:test";
import { reviewedState } from "../src/services/violationReview";

describe("reviewedState", () => {
  it("confirmed shows as confirmed, whatever the AI said", () => {
    expect(reviewedState("confirmed", true, "possible")).toEqual({ violation: true, violationStatus: "confirmed" });
  });

  it("dismissed drops the tag", () => {
    expect(reviewedState("dismissed", true, "violation")).toEqual({ violation: false, violationStatus: null });
  });

  it("undo brings back the AI's own level", () => {
    expect(reviewedState(null, true, "possible")).toEqual({ violation: true, violationStatus: "possible" });
    expect(reviewedState(null, true, "violation")).toEqual({ violation: true, violationStatus: "violation" });
  });

  it("undo on a point the AI has since unflagged leaves no tag", () => {
    expect(reviewedState(null, false, "none")).toEqual({ violation: false, violationStatus: null });
  });
});
