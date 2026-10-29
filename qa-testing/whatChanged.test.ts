import { describe, expect, it } from "bun:test";
import { compareTopicPeriods, type ChangeRow } from "../src/services/analyticsService";

const PREV: [number, number] = [0, 100];
const CUR: [number, number] = [100, 200];
const name = (id: number) => `T${id}`;
const rows = (topicId: number, t: number, n: number, sentiment: ChangeRow["sentiment"], violation = false) =>
  Array.from({ length: n }, (): ChangeRow => ({ topicId, sentiment, violation, t, text: `t${topicId} ${sentiment}` }));

describe("compareTopicPeriods", () => {
  it("judges each topic on its own complaint share, not raw counts", () => {
    const data = [
      // 1: 1/4 complaints → 3/4 — fewer mentions overall, still worse.
      ...rows(1, 50, 1, "negative"),
      ...rows(1, 50, 3, "positive"),
      ...rows(1, 150, 3, "negative"),
      ...rows(1, 150, 1, "positive"),
      // 2: 5 neutral → 2 neutral — fewer mentions, same share: not listed.
      ...rows(2, 50, 5, "neutral"),
      ...rows(2, 150, 2, "neutral"),
    ];
    const out = compareTopicPeriods(data, CUR, PREV, name)!;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "1", kind: "worse", complaints: { previous: 25, current: 75 } });
    expect(out[0]!.quote).toBe("t1 negative");
  });

  it("New = never mentioned before; a topic back after a quiet period isn't new", () => {
    const data = [
      ...rows(9, 50, 5, "neutral"), // keeps the previous period non-empty
      ...rows(3, -50, 2, "neutral"), // before both periods
      ...rows(3, 150, 3, "negative"),
      ...rows(5, 150, 3, "negative"), // truly new
      ...rows(6, 150, 3, "negative"), // seen before the fetched rows
    ];
    const out = compareTopicPeriods(data, CUR, PREV, name, new Set([6]))!;
    expect(out.find((r) => r.id === "5")).toMatchObject({ kind: "new", share: { previous: 0, current: 33 } });
    expect(out.find((r) => r.id === "3")?.kind).toBe("worse");
    expect(out.find((r) => r.id === "6")?.kind).toBe("worse");
  });

  it("lists a brand-new topic from its first mention", () => {
    const data = [...rows(9, 50, 5, "neutral"), ...rows(9, 150, 5, "neutral"), ...rows(7, 150, 1, "neutral")];
    expect(compareTopicPeriods(data, CUR, PREV, name)!.find((r) => r.id === "7")?.kind).toBe("new");
    // Seen before: one quiet mention back isn't listed.
    expect(compareTopicPeriods(data, CUR, PREV, name, new Set([7]))!.find((r) => r.id === "7")).toBeUndefined();
  });

  it("a topic back after a quiet period with 0 → 5 complaints is worse, even in a big form", () => {
    const data = [
      ...rows(9, 50, 2000, "neutral"),
      ...rows(9, 150, 2000, "neutral"),
      ...rows(8, 150, 5, "negative"),
    ];
    expect(compareTopicPeriods(data, CUR, PREV, name, new Set([8]))!.find((r) => r.id === "8")?.kind).toBe("worse");
  });

  it("puts violations first and keeps them even when steady", () => {
    const data = [
      ...rows(1, 50, 4, "positive"),
      ...rows(1, 150, 4, "negative"), // worse
      ...rows(4, 50, 3, "neutral"),
      ...rows(4, 150, 1, "neutral", true), // steady, but a violation
    ];
    const out = compareTopicPeriods(data, CUR, PREV, name)!;
    expect(out.map((r) => [r.id, r.kind])).toEqual([
      ["4", null],
      ["1", "worse"],
    ]);
  });

  it("needs enough mentions to call a shift", () => {
    const data = [
      ...rows(2, 50, 5, "neutral"),
      ...rows(2, 150, 5, "neutral"),
      ...rows(1, 50, 5, "neutral"),
      ...rows(1, 150, 1, "negative"),
    ];
    expect(compareTopicPeriods(data, CUR, PREV, name)).toEqual([]);
    const flagged = compareTopicPeriods([...data, ...rows(1, 150, 1, "neutral", true)], CUR, PREV, name)!;
    expect(flagged[0]).toMatchObject({
      kind: null,
      complaintCounts: { previous: { negative: 0, total: 5 }, current: { negative: 1, total: 2 } },
    });
  });

  it("one person's swing is 'few'; the same swing on many mentions is 'worse'", () => {
    const small = [
      ...rows(1, 50, 1, "negative"),
      ...rows(1, 50, 2, "neutral"),
      ...rows(1, 150, 2, "negative"),
      ...rows(1, 150, 1, "neutral", true), // listed via its violation
    ];
    expect(compareTopicPeriods(small, CUR, PREV, name)![0]!.kind).toBeNull();
    const large = [
      ...rows(1, 50, 30, "negative"),
      ...rows(1, 50, 70, "neutral"),
      ...rows(1, 150, 40, "negative"),
      ...rows(1, 150, 60, "neutral"),
    ];
    expect(compareTopicPeriods(large, CUR, PREV, name)![0]!.kind).toBe("worse");
  });

  it("far more mentions, now complaints, is worse", () => {
    const data = [
      ...rows(9, 50, 20, "neutral"),
      ...rows(9, 150, 20, "neutral"),
      ...rows(1, 50, 2, "neutral"),
      ...rows(1, 150, 10, "negative"),
    ];
    const out = compareTopicPeriods(data, CUR, PREV, name)!;
    expect(out[0]).toMatchObject({ id: "1", kind: "worse" });
  });

  it("steady complaint ratio but far more people complaining is worse", () => {
    const data = [
      ...rows(9, 50, 20, "neutral"),
      ...rows(9, 150, 20, "neutral"),
      ...rows(1, 50, 2, "negative"),
      ...rows(1, 50, 2, "neutral"),
      ...rows(1, 150, 10, "negative"),
      ...rows(1, 150, 10, "neutral"),
    ];
    const out = compareTopicPeriods(data, CUR, PREV, name)!;
    expect(out[0]).toMatchObject({ id: "1", kind: "worse", complaints: { previous: 50, current: 50 } });
  });

  it("worse on its complaint ratio even as fewer people mention it", () => {
    const data = [
      ...rows(9, 50, 20, "neutral"),
      ...rows(9, 150, 20, "neutral"),
      ...rows(1, 50, 6, "negative"),
      ...rows(1, 50, 15, "neutral"),
      ...rows(1, 150, 7, "negative"),
      ...rows(1, 150, 1, "neutral"),
    ];
    expect(compareTopicPeriods(data, CUR, PREV, name)![0]).toMatchObject({ id: "1", kind: "worse" });
  });

  it("a topic whose complaints vanished with it is better", () => {
    const data = [...rows(9, 50, 5, "neutral"), ...rows(9, 150, 5, "neutral"), ...rows(1, 50, 4, "negative")];
    expect(compareTopicPeriods(data, CUR, PREV, name)![0]).toMatchObject({ id: "1", kind: "better" });
  });

  it("is null when a period has no mentions", () => {
    expect(compareTopicPeriods(rows(1, 150, 5, "negative"), CUR, PREV, name)).toBeNull();
  });
});
