import { describe, expect, it } from "bun:test";

import { sampleResponses } from "../src/services/gettingStartedForm";

describe("getting-started sample", () => {
  const sample = sampleResponses(new Date("2026-10-19T12:00:00Z"));

  it("spans about six weeks, newest first, every response answering the three choice questions", () => {
    expect(sample).toHaveLength(32);
    expect(sample.every((response) => response.choices.every(Boolean))).toBe(true);
    expect(Date.parse(sample[0]!.at)).toBeGreaterThan(Date.parse(sample.at(-1)!.at));
  });

  it("gives every response a written answer, with three flagged safety or privacy reports", () => {
    const allPoints = sample.flatMap((response) => response.written.flat());
    expect(sample.every((response) => response.written.flat().length > 0)).toBe(true);
    expect(allPoints.every((point) => point.text)).toBe(true);
    expect(allPoints.filter((point) => point.violation)).toHaveLength(3);
  });
});

describe("getting-started topics", () => {
  it("has a topic (Wi-Fi) with positive, neutral and negative mentions", () => {
    const wifi = sampleResponses()
      .flatMap((response) => response.written.flat())
      .filter((point) => point.topic === "wifi");
    expect(new Set(wifi.map((point) => point.sentiment))).toEqual(new Set(["positive", "neutral", "negative"]));
  });
});
