import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, isNull, lte, max, min, ne, or, sql } from "drizzle-orm";

import {
  aiModelRuns,
  answers,
  canonicalTopics,
  db,
  fieldOptions,
  formFields,
  forms,
  points,
  submissions,
  users,
} from "../db/client";
import { normalizeDbTimestamp, parseDbTimestamp } from "../utils/timestamp";
import { createCalendar, resolveTimeZone, type Calendar } from "../utils/timezone";
import { requireFormAccess } from "./formAccess";
import { loadResponseRecords } from "./responseRecords";

const SENTIMENT_LABELS = ["positive", "neutral", "negative"] as const;

/** One field's answer breakdown, shaped to match the client's `DemographicBreakdown` union. */
export type FieldBreakdown =
  | {
      kind: "single-choice";
      id: string;
      title: string;
      options: { id: string; label: string; value: number }[];
    }
  | {
      kind: "multi-choice";
      id: string;
      title: string;
      totalRespondents: number;
      options: { id: string; label: string; value: number }[];
    }
  | { kind: "text"; id: string; title: string; responses: TextResponse[] };

/** A free-text answer, with who wrote it when the form recorded names (null: anonymous). */
export type TextResponse = { text: string; respondentName: string | null };

/**
 * The respondent's name for a submission joined to `users` (left join on
 * `submissions.userId`). Only set when the form had `recordName` on at submit time and
 * the respondent was signed in — anonymous submissions never store a user, so stay null.
 */
const respondentNameSql = sql<string | null>`coalesce(nullif(${submissions.respondentName}, ''), nullif(${users.fullName}, ''), ${users.email})`;

type Sentiment = "negative" | "neutral" | "positive";

export type ThemeKeyword = { text: string; weight: 1 | 2 | 3 };

export type ThemeFeedbackPoint = {
  id: string;
  sentiment: Sentiment;
  /** The AI pipeline flagged this point as a violation (points.is_violation). */
  violation: boolean;
  quote: string;
  originalFeedback: string;
  /** The response this came from — opens it in the Individual tab. */
  submissionId: number;
  submittedAt: string;
  /** Who wrote it, when the form recorded names; null for anonymous submissions. */
  respondentName: string | null;
  /** Index into the topic's `volumeSeries` this point was counted in (null: outside every bucket). */
  volumeBucket: number | null;
  /** The respondent's answers to the form's demographic (single-choice) questions, in form order. */
  demographics: { label: string; value: string }[];
};

/** One bucket of a topic's volume: total mentions plus their sentiment split. */
export type ThemeVolumePoint = {
  label: string;
  value: number;
  negative: number;
  neutral: number;
  positive: number;
};

export type ThemeTopic = {
  id: string;
  label: string;
  negative: number;
  neutral: number;
  positive: number;
  percentOfTotal: number;
  hasViolation: boolean;
  aiSummary: string;
  keywords: ThemeKeyword[];
  feedbackSegment: ThemeFeedbackPoint[];
  /** Mentions per bucket across the selected window (page filters applied); THEME_VOLUME_MIN_POINTS–MAX points. */
  volumeSeries: ThemeVolumePoint[];
};

/** Stands in for a topic id on the bin of feedback nothing grouped. Never a
 *  real canonical_topics row, so it must not be used to fetch one. */
const UNCATEGORISED_ID = "uncategorised";

/** Dashboard auto-bucketed charts get 6–12 x-axis points. */
const POINTS_MIN = 6;
const POINTS_MAX = 12;

/** One "What changed" row: the latest complete period vs the one before it. */
export type WhatChangedRow = {
  id: string;
  label: string;
  /** null = no clear change; only listed for its violations. */
  kind: "worse" | "better" | "new" | null;
  /** Share of mentions now ÷ before, when it at least doubled beyond chance; else null. */
  growth: number | null;
  /** The topic's share of all mentions in each period (%). */
  share: { previous: number; current: number };
  /** Share of the topic's own mentions that were negative (%). */
  complaints: { previous: number; current: number };
  /** The counts behind `complaints`: negative of total mentions, per period. */
  complaintCounts: { previous: { negative: number; total: number }; current: { negative: number; total: number } };
  /** Possible violations in the current period. */
  violations: number;
  /** One current-period point (a violation, else a complaint) — Worse / New / flagged rows. */
  quote: string | null;
};

export type WhatChanged = { currentLabel: string; previousLabel: string; rows: WhatChangedRow[] };

export type TrendBucket = "day" | "week" | "month" | "year";

/** How the topic picker ranks its list + which topics the chart auto-selects. */
export type TrendRank = "mentioned" | "violation";

/** One row of the Trend topic picker — every topic seen in the window, ranked. */
export type TrendAvailableTopic = {
  id: string;
  label: string;
  /** Mentions in the selected window. */
  mentions: number;
  /** Violations in the selected window. */
  violations: number;
};

export type TrendVolumePoint = Record<string, number | string>;
/** Raw mention counts by sentiment (not percentages). */
export type SentimentCounts = { negative: number; neutral: number; positive: number };
/** One charted topic over the whole selected window. */
export type TrendTopicSummary = SentimentCounts & { id: string; mentions: number };
export type TrendSentimentPoint = {
  label: string;
  /** Share of the period's mentions (%). */
  negative: number;
  neutral: number;
  positive: number;
  /**
   * The raw mention counts behind those percentages — a 100% from one mention
   * reads very differently from 100% of fifty.
   */
  counts: { negative: number; neutral: number; positive: number };
};

export type FormTrend = {
  bucket: TrendBucket;
  /** How `availableTopics` is ordered + how the chart auto-picked when `topics` wasn't given. */
  rank: TrendRank;
  /** The resolved window (ISO) — echoes back the caller's or the auto default. */
  from: string;
  to: string;
  rangeLabel: string;
  /** Analysed mentions for this form across ALL time — lets the UI tell "no data yet" from "range too narrow". */
  totalMentions: number;
  /** The lines currently on the chart. */
  topicVolumeSeries: { id: string; label: string }[];
  /** Every topic in the window, ranked by `rank` — powers the topic picker. */
  availableTopics: TrendAvailableTopic[];
  volumeSeries: TrendVolumePoint[];
  /**
   * Per charted topic (keyed by id): sentiment counts for each bucket, index-aligned
   * with `volumeSeries` — the Topic Trends side panel's per-period breakdown.
   */
  topicSentimentSeries: Record<string, SentimentCounts[]>;
  /** Per charted topic: mentions + sentiment over the whole window (side panel default). */
  topicSummaries: TrendTopicSummary[];
  sentimentSeries: TrendSentimentPoint[];
  /** null = the range doesn't hold two complete periods with feedback. */
  whatChanged: WhatChanged | null;
  timelineEvents: {
    id: string;
    date: string;
    description: string;
    change: number;
    metricLabel: string;
  }[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** DB `timestamptz` string → epoch ms (see parseDbTimestamp). */
const parseTs = parseDbTimestamp;

/**
 * When this form's first and last responses came in — the default Themes/Trend window.
 * Every response, not just analysed ones: a response the AI hasn't reached yet still
 * counts toward "Total Responses", so it must fall inside the default window.
 */
async function submissionSpan(formId: number): Promise<{ earliestMs: number; latestMs: number }> {
  const [span] = await db
    .select({ earliest: min(submissions.createdAt), latest: max(submissions.createdAt) })
    .from(submissions)
    .where(eq(submissions.formId, formId));
  return {
    earliestMs: span?.earliest ? parseTs(span.earliest) : NaN,
    latestMs: span?.latest ? parseTs(span.latest) : NaN,
  };
}

function resolveFeedbackWindow(
  opts: { from?: number; to?: number },
  earliestMs: number,
  latestMs: number,
): { from: number; to: number; span: number } {
  const DEFAULT_SPAN = 90 * DAY_MS;
  // +1ms: Postgres keeps microseconds, JS only milliseconds, so the newest
  // submission sits just after `latestMs` and `<= to` would drop it.
  const defaultTo = Number.isFinite(latestMs) ? latestMs + 1 : Date.now();
  const defaultFrom = Number.isFinite(earliestMs) ? earliestMs : defaultTo - DEFAULT_SPAN;
  const to = Number.isFinite(opts.to) ? (opts.to as number) : defaultTo;
  let from = Number.isFinite(opts.from) ? (opts.from as number) : defaultFrom;
  if (!(from < to)) from = to - DEFAULT_SPAN;
  return { from, to, span: Math.max(DAY_MS, to - from) };
}

const TREND_BUCKETS: readonly TrendBucket[] = ["day", "week", "month", "year"];
export const isTrendBucket = (v: string | undefined): v is TrendBucket =>
  v !== undefined && (TREND_BUCKETS as readonly string[]).includes(v);

const TREND_RANKS: readonly TrendRank[] = ["mentioned", "violation"];
export const isTrendRank = (v: string | undefined): v is TrendRank =>
  v !== undefined && (TREND_RANKS as readonly string[]).includes(v);

/** Default line count when the chart auto-picks; hard cap when the caller picks. */
const TREND_SERIES_DEFAULT = 3;
const TREND_SERIES_MAX = 8;
/** Rows sent to the picker — beyond this, topics have negligible volume anyway. */
const TREND_AVAILABLE_LIMIT = 500;

/** What changed: Worse / Better = the topic's complaint share moved ≥ 10 pts… */
const CHANGE_MIN_SHIFT = 0.1;
/** …beyond chance: a two-proportion z ≥ this (≈ 90% one-sided)… */
const CHANGE_MIN_Z = 1.28;
/** …with this many mentions in the period it's judged on (violations are always listed). */
const CHANGE_MIN_MENTIONS = 3;
/** The "N× mentions" tag, and Worse / Better on complaint counts: share of all mentions ≥ this × the previous. */
const GROWTH_MIN_RATIO = 2;

/** Two-proportion z score of x1/n1 vs x0/n0 (pooled); 0 when it can't be computed. */
function zScore(x0: number, n0: number, x1: number, n1: number): number {
  if (n0 === 0 || n1 === 0) return 0;
  const p = (x0 + x1) / (n0 + n1);
  const se = Math.sqrt(p * (1 - p) * (1 / n0 + 1 / n1));
  return se > 0 ? (x1 / n1 - x0 / n0) / se : 0;
}
const CHANGE_LIMIT = 50;
/** Timeline spike: a bucket count ≥ SPIKE_MIN_COUNT and ≥ SPIKE_MIN_ABOVE over the topic's earlier-bucket average. */
const SPIKE_MIN_COUNT = 3;
const SPIKE_MIN_ABOVE = 2;

/** Bucket sizes tried finest → coarsest: a unit plus how many units each bucket spans. */
const VOLUME_STEPS: readonly { bucket: TrendBucket; every: number }[] = [
  { bucket: "day", every: 1 },
  { bucket: "day", every: 2 },
  { bucket: "day", every: 3 },
  { bucket: "week", every: 1 },
  { bucket: "week", every: 2 },
  { bucket: "month", every: 1 },
  { bucket: "month", every: 2 },
  { bucket: "month", every: 3 },
  { bucket: "month", every: 6 },
  { bucket: "year", every: 1 },
  { bucket: "year", every: 2 },
  { bucket: "year", every: 5 },
  { bucket: "year", every: 10 },
  { bucket: "year", every: 25 },
];

export type ChangeRow = { topicId: number; sentiment: Sentiment; violation: boolean; t: number; text: string };

/**
 * What changed between two periods ([start, end) ms), judged on each topic's own
 * complaint share (negative / its mentions) — a ratio, so fewer responses overall
 * doesn't make every topic "better" — and only when the move is beyond chance, so
 * 1/3 → 2/3 isn't "worse". New = no mentions in `prev`. Violation rows
 * first, then biggest shift.
 * null when either period has no mentions.
 */
export function compareTopicPeriods(
  rows: ChangeRow[],
  cur: [number, number],
  prev: [number, number],
  nameOf: (id: number) => string,
): WhatChangedRow[] | null {
  type Tally = { total: number; neg: number; violations: number; quote: string | null; quoteRank: number };
  const tally = ([start, end]: [number, number]) => {
    const map = new Map<number, Tally>();
    let all = 0;
    for (const r of rows) {
      if (r.t < start || r.t >= end) continue;
      all += 1;
      const t = map.get(r.topicId) ?? { total: 0, neg: 0, violations: 0, quote: null, quoteRank: -1 };
      t.total += 1;
      if (r.sentiment === "negative") t.neg += 1;
      if (r.violation) t.violations += 1;
      const rank = r.violation ? 2 : r.sentiment === "negative" ? 1 : 0;
      if (rank > t.quoteRank && r.text.trim()) {
        t.quote = r.text.trim();
        t.quoteRank = rank;
      }
      map.set(r.topicId, t);
    }
    return { map, all };
  };
  const c = tally(cur);
  const p = tally(prev);
  if (c.all === 0 || p.all === 0) return null;

  const zero: Tally = { total: 0, neg: 0, violations: 0, quote: null, quoteRank: -1 };
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

  const out: (WhatChangedRow & { shift: number })[] = [];
  for (const id of new Set([...c.map.keys(), ...p.map.keys()])) {
    const a = c.map.get(id) ?? zero;
    const b = p.map.get(id) ?? zero;
    if (a.violations === 0 && Math.max(a.total, b.total) < CHANGE_MIN_MENTIONS) continue;
    const ratio = (t: Tally) => (t.total > 0 ? t.neg / t.total : 0);
    const shift = ratio(a) - ratio(b);
    const clear = Math.abs(zScore(b.neg, b.total, a.neg, a.total)) >= CHANGE_MIN_Z;
    const shareGrowth = b.total > 0 ? a.total / c.all / (b.total / p.all) : 0;
    const growth =
      a.total >= CHANGE_MIN_MENTIONS &&
      shareGrowth >= GROWTH_MIN_RATIO &&
      zScore(b.total, p.all, a.total, c.all) >= CHANGE_MIN_Z
        ? Math.round(shareGrowth * 10) / 10
        : null;
    // Second signal: complaints as a share of ALL mentions — more people complaining,
    // even when the topic's own complaint ratio holds steady.
    const countZ = zScore(b.neg, p.all, a.neg, c.all);
    const countUp =
      a.neg >= CHANGE_MIN_MENTIONS && countZ >= CHANGE_MIN_Z && a.neg / c.all >= (GROWTH_MIN_RATIO * b.neg) / p.all;
    const countDown =
      b.neg >= CHANGE_MIN_MENTIONS && countZ <= -CHANGE_MIN_Z && b.neg / p.all >= (GROWTH_MIN_RATIO * a.neg) / c.all;
    const ratioUp = shift >= CHANGE_MIN_SHIFT && clear && a.total >= CHANGE_MIN_MENTIONS;
    const ratioDown = shift <= -CHANGE_MIN_SHIFT && clear && b.total >= CHANGE_MIN_MENTIONS;
    // Either signal up wins: more unhappy people is worse even if the ratio fell.
    const kind: WhatChangedRow["kind"] =
      b.total === 0
        ? "new"
        : a.total === 0
          ? b.neg >= CHANGE_MIN_MENTIONS ? "better" : null // complaints gone with the topic
          : ratioUp || countUp
            ? "worse"
            : ratioDown || countDown
              ? "better"
              : null;
    if (kind === null && a.violations === 0) continue;
    out.push({
      id: String(id),
      label: nameOf(id),
      kind,
      growth,
      share: { previous: pct(b.total, p.all), current: pct(a.total, c.all) },
      complaints: { previous: pct(b.neg, b.total), current: pct(a.neg, a.total) },
      complaintCounts: {
        previous: { negative: b.neg, total: b.total },
        current: { negative: a.neg, total: a.total },
      },
      violations: a.violations,
      quote: kind === "better" && a.violations === 0 ? null : a.quote,
      shift,
    });
  }
  return out
    .sort((x, y) => y.violations - x.violations || Math.abs(y.shift) - Math.abs(x.shift))
    .slice(0, CHANGE_LIMIT)
    .map(({ shift: _, ...row }) => row);
}

/**
 * Chart buckets for a window: the finest step that yields between `min` and `max`
 * points. A window too short to reach `min` (under ~4 days) gets the most points the
 * finest step can give; one too long for any step is capped at the coarsest.
 */
function volumeBuckets(
  cal: Calendar,
  from: number,
  to: number,
  min: number,
  max: number,
): { bucket: TrendBucket; starts: number[] } {
  const startsFor = ({ bucket, every }: (typeof VOLUME_STEPS)[number]) => {
    const out: number[] = [];
    let t = cal.start(from, bucket);
    while (t <= to) {
      out.push(t);
      for (let i = 0; i < every; i += 1) t = cal.next(t, bucket);
    }
    return out;
  };
  let fallback: { bucket: TrendBucket; starts: number[] } | null = null;
  for (const step of VOLUME_STEPS) {
    const starts = startsFor(step);
    if (starts.length >= min && starts.length <= max) return { bucket: step.bucket, starts };
    if (starts.length <= max && !fallback) fallback = { bucket: step.bucket, starts };
  }
  if (fallback) return fallback;
  const last = VOLUME_STEPS[VOLUME_STEPS.length - 1]!;
  return { bucket: last.bucket, starts: startsFor(last).slice(0, max) };
}

const SENTIMENTS: readonly Sentiment[] = ["negative", "neutral", "positive"];
const isSentiment = (value: string | null): value is Sentiment =>
  value !== null && (SENTIMENTS as readonly string[]).includes(value);

/** "curriculum, outdated courses, projects" → weighted keyword chips (first ones heavier). */
function parseKeywords(raw: string | null): ThemeKeyword[] {
  const words = (raw ?? "")
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 8);
  return words.map((text, index) => ({ text, weight: index < 2 ? 3 : index < 5 ? 2 : 1 }));
}


/**
 * A form's demographic answers + the Themes/Trend demographic filter. `demo` maps a
 * demographic question label to the chosen answers; a submission matches when its
 * answer to every non-empty entry is one of them.
 */
async function loadDemographics(formId: number, demo: Record<string, string[]> | undefined) {
  // The respondent's demographic answers per submission — whatever single-choice
  // questions this form's demographic section has (Year, Department, Age, …), kept
  // generic and in form order rather than mapped to fixed slots.
  const demoRows = await db
    .select({
      submissionId: answers.submissionId,
      fieldId: formFields.id,
      order: formFields.fieldOrder,
      label: formFields.fieldLabel,
      option: fieldOptions.optionLabel,
    })
    .from(answers)
    .innerJoin(formFields, eq(answers.fieldId, formFields.id))
    .innerJoin(fieldOptions, eq(answers.answerOptionId, fieldOptions.id))
    .where(
      and(
        eq(formFields.formId, formId),
        eq(formFields.section, "demographic"),
        eq(formFields.fieldType, "radio"),
      ),
    );

  type DemoAnswer = { fieldId: number; order: number; label: string; value: string };
  const demoBySubmission = new Map<number, DemoAnswer[]>();
  for (const row of demoRows) {
    const list = demoBySubmission.get(row.submissionId) ?? [];
    if (list.some((entry) => entry.fieldId === row.fieldId)) continue; // one answer per radio field
    list.push({
      fieldId: row.fieldId,
      order: row.order ?? 0,
      label: row.label ?? "Question",
      value: row.option ?? "",
    });
    demoBySubmission.set(row.submissionId, list);
  }

  // Demographic filter: keep only submissions whose answer to every selected
  // question is one of the chosen values. `demographicFilters` (below) comes from the
  // form definition, so the options don't vanish as the user narrows down.
  const filterEntries = Object.entries(demo ?? {}).filter(([, values]) => values.length > 0);
  const matchesDemo = (submissionId: number) =>
    filterEntries.every(([label, values]) =>
      (demoBySubmission.get(submissionId) ?? []).some(
        (entry) => entry.label === label && values.includes(entry.value || "Unspecified"),
      ),
    );
  // Every demographic question and answer option the form has in the database —
  // current and soft-deleted — not just the ones respondents happened to pick. Groups
  // are keyed by label (that's what the filter matches on), so a removed question and
  // its replacement of the same name share one group.
  const demoFieldRows = await db
    .select({
      fieldOrder: formFields.fieldOrder,
      label: formFields.fieldLabel,
      optionLabel: fieldOptions.optionLabel,
      optionOrder: fieldOptions.optionOrder,
    })
    .from(formFields)
    .leftJoin(fieldOptions, eq(fieldOptions.fieldId, formFields.id))
    .where(
      and(
        eq(formFields.formId, formId),
        eq(formFields.section, "demographic"),
        eq(formFields.fieldType, "radio"),
      ),
    )
    .orderBy(formFields.fieldOrder, fieldOptions.optionOrder);
  const demographicFilters = (() => {
    const byLabel = new Map<string, Set<string>>();
    for (const row of demoFieldRows) {
      const options = byLabel.get(row.label ?? "Question") ?? new Set<string>();
      if (row.optionLabel) options.add(row.optionLabel);
      byLabel.set(row.label ?? "Question", options);
    }
    return [...byLabel.entries()].map(([label, options]) => ({ label, options: [...options] }));
  })();


  return {
    demoBySubmission,
    matchesDemo,
    isFiltering: filterEntries.length > 0,
    demographicFilters,
  };
}

export const analyticsService = {
  async summary(adminId: number) {
    const [formsCount] = await db.select({ value: count() }).from(forms).where(eq(forms.adminId, adminId));

    const [submissionsCount] = await db
      .select({ value: count() })
      .from(submissions)
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .where(eq(forms.adminId, adminId));

    const sentimentRows = await db
      .select({ sentimentLabel: points.sentimentLabel, value: count() })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .where(eq(forms.adminId, adminId))
      .groupBy(points.sentimentLabel);

    const [violationCount] = await db
      .select({ value: count() })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .where(and(eq(forms.adminId, adminId), eq(points.isViolation, true)));

    // Topics on this admin's forms. (canonical_topics no longer has a status column —
    // every row is a live topic.)
    const [topicsCount] = await db
      .select({ value: count() })
      .from(canonicalTopics)
      .innerJoin(forms, eq(canonicalTopics.formId, forms.id))
      .where(eq(forms.adminId, adminId));

    const sentimentBreakdown: Record<(typeof SENTIMENT_LABELS)[number], number> = {
      positive: 0,
      neutral: 0,
      negative: 0,
    };

    for (const row of sentimentRows) {
      if (row.sentimentLabel && (SENTIMENT_LABELS as readonly string[]).includes(row.sentimentLabel)) {
        sentimentBreakdown[row.sentimentLabel as (typeof SENTIMENT_LABELS)[number]] = row.value;
      }
    }

    return {
      forms: formsCount?.value ?? 0,
      submissions: submissionsCount?.value ?? 0,
      topics: topicsCount?.value ?? 0,
      violations: violationCount?.value ?? 0,
      sentimentBreakdown,
    };
  },

  /**
   * Weekly per-topic feedback counts (newest week first).
   *
   * The week comes from the answer, not the point. `points.created_at` is
   * when the AI pipeline wrote the row, and the pipeline runs in batches —
   * every point from a single run shares one timestamp, which collapsed the
   * whole chart into one bar. The answer carries when the student actually
   * submitted, which is what a trend over time means.
   */
  async trends(limit = 20) {
    const periodStart = sql<string>`date_trunc('week', ${answers.createdAt})`;

    return db
      .select({
        topicId: points.canonicalTopicId,
        topicName: canonicalTopics.canonicalName,
        periodStart: sql<string>`${periodStart}`.as("period_start"),
        periodEnd: sql<string>`${periodStart} + interval '7 days'`.as("period_end"),
        feedbackCount: count(),
        positiveCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'positive')`.mapWith(Number),
        neutralCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'neutral')`.mapWith(Number),
        negativeCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'negative')`.mapWith(Number),
        violationCount: sql<number>`count(*) filter (where ${points.isViolation})`.mapWith(Number),
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(canonicalTopics, eq(points.canonicalTopicId, canonicalTopics.id))
      .groupBy(points.canonicalTopicId, canonicalTopics.canonicalName, periodStart)
      .orderBy(desc(periodStart), points.canonicalTopicId)
      .limit(limit);
  },

  /**
   * Per-field answer breakdown for one form — powers the Dashboard's Response tab.
   * Fields split by `section`: demographic vs feedback. radio → pie (`single-choice`),
   * checkbox → bar (`multi-choice`), text/textarea → response list (`text`).
   */
  async formResponses(formId: number, adminId: number) {
    await requireFormAccess(formId, adminId, "view");

    const fields = await db
      .select({
        id: formFields.id,
        label: formFields.fieldLabel,
        type: formFields.fieldType,
        section: formFields.section,
        order: formFields.fieldOrder,
        deletedAt: formFields.deletedAt,
      })
      .from(formFields)
      .where(eq(formFields.formId, formId))
      .orderBy(formFields.fieldOrder);

    const options = await db
      .select({
        id: fieldOptions.id,
        fieldId: fieldOptions.fieldId,
        label: fieldOptions.optionLabel,
        order: fieldOptions.optionOrder,
        deletedAt: fieldOptions.deletedAt,
      })
      .from(fieldOptions)
      .innerJoin(formFields, eq(fieldOptions.fieldId, formFields.id))
      .where(eq(formFields.formId, formId))
      .orderBy(fieldOptions.optionOrder);

    const [totals] = await db
      .select({ value: count(), latest: max(submissions.createdAt) })
      .from(submissions)
      .where(eq(submissions.formId, formId));
    const totalResponses = totals?.value ?? 0;
    /** When the newest response came in — the Response tab's "Last response". */
    const lastResponseAt = totals?.latest ? normalizeDbTimestamp(totals.latest) : null;

    // How many times each option was picked (across every choice field).
    const optionCountRows = await db
      .select({ optionId: answers.answerOptionId, value: count() })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(and(eq(submissions.formId, formId), isNotNull(answers.answerOptionId)))
      .groupBy(answers.answerOptionId);
    const optionCounts = new Map(optionCountRows.map((row) => [row.optionId, row.value]));

    // Distinct submissions that answered each field (multi-choice "respondents").
    const respondentRows = await db
      .select({ fieldId: answers.fieldId, value: countDistinct(answers.submissionId) })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(eq(submissions.formId, formId))
      .groupBy(answers.fieldId);
    const fieldRespondents = new Map(respondentRows.map((row) => [row.fieldId, row.value]));

    // Free-text answers, newest first.
    const textRows = await db
      .select({ fieldId: answers.fieldId, text: answers.answerText, respondentName: respondentNameSql })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .leftJoin(users, eq(submissions.userId, users.id))
      .where(and(eq(submissions.formId, formId), isNotNull(answers.answerText)))
      .orderBy(desc(answers.createdAt));

    const optionsByField = new Map<number, typeof options>();
    for (const option of options) {
      const bucket = optionsByField.get(option.fieldId);
      if (bucket) bucket.push(option);
      else optionsByField.set(option.fieldId, [option]);
    }

    const toBreakdown = (field: (typeof fields)[number]): FieldBreakdown | null => {
      const id = String(field.id);
      // Questions/options an admin removed after responses came in are kept (soft-deleted)
      // so their collected answers still show — flagged, and dropped when nobody answered.
      if (field.deletedAt && (fieldRespondents.get(field.id) ?? 0) === 0) return null;
      const title = `${field.label ?? "Untitled question"}${field.deletedAt ? " (removed)" : ""}`;

      if (field.type === "radio" || field.type === "checkbox") {
        const opts = (optionsByField.get(field.id) ?? [])
          .filter((option) => !option.deletedAt || (optionCounts.get(option.id) ?? 0) > 0)
          .map((option) => ({
            id: String(option.id),
            label: `${option.label ?? ""}${option.deletedAt ? " (removed)" : ""}`,
            value: optionCounts.get(option.id) ?? 0,
          }));

        return field.type === "checkbox"
          ? { kind: "multi-choice", id, title, totalRespondents: fieldRespondents.get(field.id) ?? 0, options: opts }
          : { kind: "single-choice", id, title, options: opts };
      }

      if (field.type === "text" || field.type === "textarea") {
        return {
          kind: "text",
          id,
          title,
          responses: textRows
            .filter((row) => row.fieldId === field.id && row.text && row.text.trim() !== "")
            .map((row) => ({ text: row.text as string, respondentName: row.respondentName ?? null })),
        };
      }

      return null;
    };

    const demographic: FieldBreakdown[] = [];
    const feedback: FieldBreakdown[] = [];
    for (const field of fields) {
      const breakdown = toBreakdown(field);
      if (!breakdown) continue;
      (field.section === "demographic" ? demographic : feedback).push(breakdown);
    }

    return { totalResponses, lastResponseAt, demographic, feedback };
  },

  /** Each submission's full set of answers, newest first — the Dashboard's Individual tab. */
  async individualResponses(formId: number, adminId: number) {
    const { fields, records } = await loadResponseRecords(formId, adminId);
    return {
      fields,
      responses: records
        .map((record, index) => ({
          id: record.id,
          /** 1 = the first response ever submitted. */
          number: index + 1,
          submittedAt: record.submittedAt,
          respondentName: record.respondentName,
          answers: Object.fromEntries(record.answers),
        }))
        .reverse(),
    };
  },

  /**
   * Theme analysis for one form's Dashboard "Themes" tab: overall sentiment, the
   * canonical topics its analysed feedback maps to (per-topic sentiment split,
   * keywords, and a demographic-tagged sample of feedback points), and the
   * topics with violations.
   */
  async formThemes(
    formId: number,
    adminId: number,
    opts: { from?: number; to?: number; demo?: Record<string, string[]>; timeZone?: string } = {},
  ) {
    const form = await requireFormAccess(formId, adminId, "view");
    const cal = createCalendar(resolveTimeZone(opts.timeZone));

    // Same default window as the Trend tab: every response's span; explicit from/to win.
    const [[allTime], { earliestMs, latestMs }] = await Promise.all([
      db
        .select({ value: count() })
        .from(points)
        .innerJoin(answers, eq(points.answerId, answers.id))
        .innerJoin(submissions, eq(answers.submissionId, submissions.id))
        .where(and(eq(submissions.formId, formId), ne(points.processingStatus, "pending"))),
      submissionSpan(formId),
    ]);
    const totalMentions = allTime?.value ?? 0;
    const { from, to } = resolveFeedbackWindow(opts, earliestMs, latestMs);
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();
    const rangeLabel = `${cal.date(from)} – ${cal.date(to)}`;
    const inWindow = and(
      gte(submissions.createdAt, fromIso),
      lte(submissions.createdAt, toIso),
    );

    const windowSubmissions = await db
      .select({ id: submissions.id, createdAt: submissions.createdAt })
      .from(submissions)
      .where(and(eq(submissions.formId, formId), inWindow));

    // Every analysed point for this form in the window, with its source answer text + submission.
    const pointRows = await db
      .select({
        id: points.id,
        topicId: points.canonicalTopicId,
        // 'unknown' is a point the pipeline looked at and could not place;
        // 'pending' is one it has not reached yet. Both carry a null topic,
        // so the status is the only thing that tells them apart.
        status: points.processingStatus,
        sentiment: points.sentimentLabel,
        violation: points.isViolation,
        pointText: points.pointText,
        originalFeedback: answers.answerText,
        submissionId: submissions.id,
        submittedAt: submissions.createdAt,
        respondentName: respondentNameSql,
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .leftJoin(users, eq(submissions.userId, users.id))
      .where(and(eq(submissions.formId, formId), inWindow))
      .orderBy(desc(submissions.createdAt));

    const { demoBySubmission, matchesDemo, isFiltering, demographicFilters } = await loadDemographics(
      formId,
      opts.demo,
    );

    if (isFiltering) {
      for (let i = pointRows.length - 1; i >= 0; i -= 1) {
        if (!matchesDemo(pointRows[i]!.submissionId)) pointRows.splice(i, 1);
      }
    }
    const matchingSubmissions = windowSubmissions.filter((row) => matchesDemo(row.id));
    const totalResponders = matchingSubmissions.length;

    // Of those, the responses the AI pipeline hasn't finished: an analysed-field answer
    // not yet decomposed (gnp-ai's queue marker) or one with a point still pending.
    const awaitingRows = await db
      .selectDistinct({ id: answers.submissionId })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .innerJoin(formFields, eq(answers.fieldId, formFields.id))
      .leftJoin(points, and(eq(points.answerId, answers.id), eq(points.processingStatus, "pending")))
      .where(
        and(
          eq(submissions.formId, formId),
          inWindow,
          eq(formFields.analyzeWithAi, true),
          isNull(formFields.deletedAt),
          isNotNull(answers.answerText),
          or(isNull(answers.decomposedAt), isNotNull(points.id)),
        ),
      );
    const awaitingAnalysis = awaitingRows.filter((row) => matchesDemo(row.id)).length;

    // Responders (same date + demographic filters) on the window's last calendar day,
    // in the viewer's time zone: "today" when that is today, else that date.
    const lastDayStart = Math.max(from, cal.start(to - 1, "day"));
    const recentResponders = matchingSubmissions.filter((row) => {
      const t = row.createdAt ? parseTs(row.createdAt) : NaN;
      return t >= lastDayStart && t <= to;
    }).length;
    const endsToday = cal.start(Date.now(), "day") === cal.start(to - 1, "day");
    // "14 Oct 2026" — short enough for one line on the stat card.
    const lastDay = `${cal.label(lastDayStart, "day")} ${cal.label(lastDayStart, "year")}`;
    const responderDeltaLabel = `+${recentResponders} ${endsToday ? "today" : `on ${lastDay}`}`;

    const overall: Record<Sentiment, number> = { negative: 0, neutral: 0, positive: 0 };
    for (const row of pointRows) {
      if (isSentiment(row.sentiment)) overall[row.sentiment] += 1;
    }
    // Score on 0–5: positive = 5, neutral = 2.5, negative = 0 — i.e. net sentiment
    // (−1…+1) stretched onto the gauge. Same formula as the client's topic panel
    // (gnp-client sentimentScore). Shares are derived client-side from the counts.
    const overallTotal = overall.negative + overall.neutral + overall.positive;
    const sentiment = {
      score: overallTotal
        ? Math.round(((overall.positive * 5 + overall.neutral * 2.5) / overallTotal) * 10) / 10
        : 0,
      outOf: 5,
      /** Raw feedback-point counts. */
      negative: overall.negative,
      neutral: overall.neutral,
      positive: overall.positive,
    };

    const assigned = pointRows.filter((row) => row.topicId !== null && isSentiment(row.sentiment));
    // Feedback the pipeline placed nowhere. Worth a card of its own: these are
    // real submissions, often the most specific ones, and dropping them left
    // them counted in the sentiment gauge but visible in no topic.
    const uncategorised = pointRows.filter(
      (row) => row.topicId === null && row.status === "unknown" && isSentiment(row.sentiment),
    );
    // Percentages are of everything the pipeline has classified, so the cards
    // add up to 100 rather than quietly leaving the unplaced out.
    const assignedTotal = assigned.length + uncategorised.length || 1;
    const topicIds = [...new Set(assigned.map((row) => row.topicId as number))];

    const topicMeta =
      topicIds.length > 0
        ? await db
            .select({
              id: canonicalTopics.id,
              name: canonicalTopics.canonicalName,
              summary: canonicalTopics.canonicalSummary,
              keywords: canonicalTopics.representativeKeywords,
            })
            .from(canonicalTopics)
            .where(inArray(canonicalTopics.id, topicIds))
        : [];
    const metaById = new Map(topicMeta.map((meta) => [meta.id, meta]));

    const volume = volumeBuckets(cal, from, to, POINTS_MIN, POINTS_MAX);
    const bucketIndexOf = (iso: string | null) => {
      const t = iso ? parseTs(iso) : NaN;
      if (Number.isNaN(t)) return -1;
      let index = -1;
      for (let i = 0; i < volume.starts.length && volume.starts[i]! <= t; i += 1) index = i;
      return index;
    };

    const buildTopic = (
      id: string,
      label: string,
      summary: string,
      keywords: ThemeKeyword[],
      rows: typeof pointRows,
    ): ThemeTopic => {
      const counts: Record<Sentiment, number> = { negative: 0, neutral: 0, positive: 0 };
      let violations = 0;
      for (const row of rows) {
        counts[row.sentiment as Sentiment] += 1;
        if (row.violation) violations += 1;
      }

      const volumeCounts = volume.starts.map(() => ({ negative: 0, neutral: 0, positive: 0 }));
      const bucketOfRow = new Map<(typeof rows)[number], number>();
      for (const row of rows) {
        const index = bucketIndexOf(row.submittedAt);
        if (index >= 0) {
          volumeCounts[index]![row.sentiment as Sentiment] += 1;
          bucketOfRow.set(row, index);
        }
      }

      // Every point in the topic, not a sample — the panel has its own sort and filter.
      const feedbackSegment: ThemeFeedbackPoint[] = rows.map((row) => ({
        id: String(row.id),
        sentiment: row.sentiment as Sentiment,
        violation: Boolean(row.violation),
        quote: row.pointText ?? "",
        originalFeedback: row.originalFeedback ?? row.pointText ?? "",
        submissionId: row.submissionId,
        submittedAt: row.submittedAt ?? new Date().toISOString(),
        respondentName: row.respondentName ?? null,
        volumeBucket: bucketOfRow.get(row) ?? null,
        demographics: [...(demoBySubmission.get(row.submissionId) ?? [])]
          .sort((a, b) => a.order - b.order)
          .map((entry) => ({ label: entry.label, value: entry.value || "Unspecified" })),
      }));

      return {
        id,
        label,
        negative: counts.negative,
        neutral: counts.neutral,
        positive: counts.positive,
        percentOfTotal: Math.round((rows.length / assignedTotal) * 1000) / 10,
        hasViolation: violations > 0,
        aiSummary: summary,
        keywords,
        feedbackSegment,
        volumeSeries: volume.starts.map((start, i) => {
          const bucket = volumeCounts[i]!;
          return {
            label: cal.label(start, volume.bucket),
            value: bucket.negative + bucket.neutral + bucket.positive,
            ...bucket,
          };
        }),
      };
    };

    const topics: ThemeTopic[] = topicIds.map((topicId) => {
      const meta = metaById.get(topicId);
      return buildTopic(
        String(topicId),
        meta?.name ?? "Untitled topic",
        meta?.summary ?? "",
        parseKeywords(meta?.keywords ?? null),
        assigned.filter((row) => row.topicId === topicId),
      );
    });

    // Same order as the dashboard's default "Priority" sort: most negative
    // feedback first (often mentioned *and* negative), then the more mentioned topic.
    topics.sort(
      (a, b) =>
        b.negative - a.negative ||
        b.negative + b.neutral + b.positive - (a.negative + a.neutral + a.positive),
    );

    // Appended after the sort, and after violationTopics is taken from
    // `topics`: it is a leftover bin, so it belongs at the end of the list and
    // not in a count of themes that need attention — even when something in it
    // is flagged, which its own badge still shows.
    const unplaced = uncategorised.length
      ? buildTopic(
          UNCATEGORISED_ID,
          "Uncategorised feedback",
          "Feedback the model could not group with anything else — usually a one-off, " +
            "or an issue too new to have been raised by enough people yet.",
          [],
          uncategorised,
        )
      : null;

    // When gnp-ai last finished a clustering run for this form (ai_model_runs is written
    // once per completed run) — the Themes/Trend "AI analysed" time.
    const [lastRun] = await db
      .select({ at: max(aiModelRuns.completedAt) })
      .from(aiModelRuns)
      .where(and(eq(aiModelRuns.formId, formId), eq(aiModelRuns.status, "completed")));

    return {
      from: fromIso,
      to: toIso,
      rangeLabel,
      lastAnalysedAt: lastRun?.at ? normalizeDbTimestamp(lastRun.at) : null,
      /** Analysed mentions across ALL time — lets the UI tell "none yet" from "none in range". */
      totalMentions,
      totalResponders,
      /** Of `totalResponders`, how many the AI pipeline hasn't analysed yet. */
      awaitingAnalysis,
      responderDelta: recentResponders,
      responderDeltaLabel,
      demographicFilters,
      sentiment,
      violationTopics: topics.filter((topic) => topic.hasViolation),
      aiDiscoveredTopics: unplaced ? [...topics, unplaced] : topics,
    };
  },

  /**
   * Trend tab for one form, over a caller-chosen time range + bucket granularity
   * (day / week / month / year). Buckets the form's analysed feedback into a real
   * time series — `volumeSeries` (per charted topic) and `sentimentSeries` (% per
   * bucket). What changed compares the latest complete period (the bucket unit, no
   * finer than a week) with the one before. The Timeline lists topic spikes within
   * the chart buckets.
   *
   * Which topics get a line: `topics` (explicit ids from the picker, cap 8) wins;
   * otherwise the top 5 by `rank` (mentioned / violation) that clear a small volume
   * floor. `availableTopics` returns *every* in-window topic ranked, so the picker
   * can search/scroll the full set.
   */
  async formTrend(
    formId: number,
    adminId: number,
    opts: {
      from?: number;
      to?: number;
      bucket?: TrendBucket;
      rank?: TrendRank;
      topics?: number[];
      timeZone?: string;
      /** Same demographic filter as the Themes tab — see loadDemographics. */
      demo?: Record<string, string[]>;
    } = {},
  ): Promise<FormTrend> {
    await requireFormAccess(formId, adminId, "view");
    const cal = createCalendar(resolveTimeZone(opts.timeZone));

    // Analysed mentions for this form across all time, and the default window — every
    // response's span, same as the Themes tab (see submissionSpan).
    const [[allTime], { earliestMs, latestMs }] = await Promise.all([
      db
        .select({ value: count() })
        .from(points)
        .innerJoin(answers, eq(points.answerId, answers.id))
        .innerJoin(submissions, eq(answers.submissionId, submissions.id))
        .where(and(eq(submissions.formId, formId), ne(points.processingStatus, "pending"))),
      submissionSpan(formId),
    ]);
    const totalMentions = allTime?.value ?? 0;

    // Explicit from/to from the date filter always win (see resolveFeedbackWindow).
    const window = resolveFeedbackWindow(opts, earliestMs, latestMs);
    const { from, span } = window;
    // `to` = the end of the last selected day, so the rolling windows below cover whole
    // days. The date filter already sends 23:59:59.999; the default ends at the last response.
    const to = Number.isFinite(opts.to) ? window.to : cal.next(cal.start(window.to, "day"), "day") - 1;
    // No explicit bucket = "auto": pick a step that gives the charts 6–12 x-axis points
    // (it can span several units, e.g. 2 weeks). `bkt` is then that step's unit, which
    // What changed below also keys off.
    const autoVolume = opts.bucket ? null : volumeBuckets(cal, from, to, POINTS_MIN, POINTS_MAX);
    const bkt: TrendBucket = opts.bucket ?? autoVolume!.bucket;
    const rank: TrendRank = opts.rank ?? "mentioned";
    // What changed: the latest complete period ending by `to` (or now) vs the one before.
    // Skipped when that period starts before the range's first chart bucket.
    const unit: TrendBucket = bkt === "day" ? "week" : bkt;
    const lastMs = Math.min(to, Date.now());
    let curStart = cal.start(lastMs, unit);
    if (cal.next(curStart, unit) > lastMs + 1) curStart = cal.prev(curStart, unit);
    const prevStart = cal.prev(curStart, unit);
    const periodLabel = (k: number) => (unit === "week" ? `Week of ${cal.label(k, unit)}` : cal.label(k, unit));
    const prevFrom = Math.min(from - span, prevStart);

    const rangeLabel = `${cal.date(from)} – ${cal.date(to)}`;
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();

    const empty: FormTrend = {
      bucket: bkt,
      rank,
      from: fromIso,
      to: toIso,
      rangeLabel,
      totalMentions,
      topicVolumeSeries: [],
      availableTopics: [],
      volumeSeries: [],
      topicSentimentSeries: {},
      topicSummaries: [],
      sentimentSeries: [],
      whatChanged: null,
      timelineEvents: [],
    };

    // Analysed points from the previous window's start through the selected `to`.
    const rows = await db
      .select({
        topicId: points.canonicalTopicId,
        sentiment: points.sentimentLabel,
        violation: points.isViolation,
        text: points.pointText,
        submittedAt: submissions.createdAt,
        submissionId: submissions.id,
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(
        and(
          eq(submissions.formId, formId),
          isNotNull(points.canonicalTopicId),
          isNotNull(submissions.createdAt),
          gte(submissions.createdAt, new Date(prevFrom).toISOString()),
          lte(submissions.createdAt, new Date(to).toISOString()),
        ),
      );

    // Demographic filter applies to everything below: series, picker, What changed.
    const { matchesDemo, isFiltering } = opts.demo
      ? await loadDemographics(formId, opts.demo)
      : { matchesDemo: () => true, isFiltering: false };

    type CleanRow = ChangeRow;
    const clean: CleanRow[] = [];
    for (const row of rows) {
      if (isFiltering && !matchesDemo(row.submissionId)) continue;
      const t = parseTs(row.submittedAt as string);
      if (Number.isNaN(t) || row.topicId === null || !isSentiment(row.sentiment)) continue;
      clean.push({
        topicId: row.topicId,
        sentiment: row.sentiment,
        violation: Boolean(row.violation),
        t,
        text: row.text,
      });
    }
    if (clean.length === 0) return empty;

    const current = clean.filter((r) => r.t >= from);
    // Bounded explicitly (not just "< from") since the row fetch below is widened
    // to also cover What changed's previous period, which can reach further back
    // than one selected-range span.
    const previous = clean.filter((r) => r.t >= from - span && r.t < from);
    // Every topic seen in *either* window — a topic can decline to zero in `current`
    // yet still be worth picking ("what stopped being mentioned").
    const topicIds = [...new Set(clean.map((r) => r.topicId))];
    if (current.length === 0 || topicIds.length === 0) return empty;

    const meta = await db
      .select({ id: canonicalTopics.id, name: canonicalTopics.canonicalName })
      .from(canonicalTopics)
      .where(inArray(canonicalTopics.id, topicIds));
    const nameById = new Map(meta.map((m) => [m.id, m.name ?? "Untitled topic"]));
    const nameOf = (id: number) => nameById.get(id) ?? "Untitled topic";

    // --- per-topic totals: selected window vs the previous equal window --------
    type Tally = { total: number; neg: number; pos: number; violations: number };
    const tallyBy = (list: CleanRow[]) => {
      const map = new Map<number, Tally>();
      for (const r of list) {
        const t = map.get(r.topicId) ?? { total: 0, neg: 0, pos: 0, violations: 0 };
        t.total += 1;
        if (r.sentiment === "negative") t.neg += 1;
        if (r.sentiment === "positive") t.pos += 1;
        if (r.violation) t.violations += 1;
        map.set(r.topicId, t);
      }
      return map;
    };
    const cur = tallyBy(current);
    const prev = tallyBy(previous);
    const zero: Tally = { total: 0, neg: 0, pos: 0, violations: 0 };

    const changedRows =
      curStart >= cal.start(from, bkt)
        ? compareTopicPeriods(clean, [curStart, cal.next(curStart, unit)], [prevStart, curStart], nameOf)
        : null;
    const whatChanged: WhatChanged | null = changedRows
      ? { currentLabel: periodLabel(curStart), previousLabel: periodLabel(prevStart), rows: changedRows }
      : null;

    // --- topic picker: rank every in-window topic ---------------------------
    const rankScore = (id: number): number => {
      const c = cur.get(id) ?? zero;
      return rank === "violation" ? c.violations * 100_000 + c.neg : c.total; // else "mentioned"
    };
    const rankedIds = [...topicIds].sort(
      (a, b) => rankScore(b) - rankScore(a) || (cur.get(b)?.total ?? 0) - (cur.get(a)?.total ?? 0),
    );
    const availableTopics: TrendAvailableTopic[] = rankedIds
      .slice(0, TREND_AVAILABLE_LIMIT)
      .map((id) => ({
        id: String(id),
        label: nameOf(id),
        mentions: cur.get(id)?.total ?? 0,
        violations: cur.get(id)?.violations ?? 0,
      }));

    // Which topics get a line: explicit `topics` (cap 8) wins; else the top N by
    // `rank` that clear a small volume floor (so a 500-topic form doesn't chart noise).
    let selectedIds: number[];
    if (opts.topics && opts.topics.length > 0) {
      const allowed = new Set(topicIds);
      selectedIds = opts.topics.filter((id) => allowed.has(id)).slice(0, TREND_SERIES_MAX);
    } else {
      const floor = Math.max(3, Math.round(current.length * 0.01));
      const clears = rankedIds.filter(
        (id) => Math.max(cur.get(id)?.total ?? 0, prev.get(id)?.total ?? 0) >= floor,
      );
      selectedIds = (clears.length >= TREND_SERIES_DEFAULT ? clears : rankedIds).slice(
        0,
        TREND_SERIES_DEFAULT,
      );
    }
    if (selectedIds.length === 0) selectedIds = rankedIds.slice(0, TREND_SERIES_DEFAULT);

    const topicVolumeSeries = selectedIds.map((id) => ({ id: String(id), label: nameOf(id) }));
    const seriesIds = new Set(selectedIds);

    // --- real time series over the selected window --------------------------
    const bucketKeys: number[] = [];
    if (autoVolume) {
      bucketKeys.push(...autoVolume.starts);
    } else {
      for (
        let k = cal.start(from, bkt);
        k <= to && bucketKeys.length < 400;
        k = cal.next(k, bkt)
      ) {
        bucketKeys.push(k);
      }
    }
    if (bucketKeys.length === 0) bucketKeys.push(cal.start(from, bkt));
    // Last bucket starting at or before `t` (clamped into range) — handles multi-unit steps.
    const idxFor = (t: number) => {
      let index = 0;
      for (let i = 0; i < bucketKeys.length && bucketKeys[i]! <= t; i += 1) index = i;
      return index;
    };

    const volumeSeries: TrendVolumePoint[] = bucketKeys.map((k) => {
      const point: TrendVolumePoint = { label: cal.label(k, bkt) };
      for (const id of seriesIds) point[String(id)] = 0;
      return point;
    });
    const sentimentRaw = bucketKeys.map(() => ({ negative: 0, neutral: 0, positive: 0 }));
    const bucketTopicCounts = bucketKeys.map(() => new Map<number, number>());
    const topicSentimentSeries: Record<string, SentimentCounts[]> = {};
    for (const id of seriesIds) {
      topicSentimentSeries[String(id)] = bucketKeys.map(() => ({ negative: 0, neutral: 0, positive: 0 }));
    }

    for (const r of current) {
      const i = idxFor(r.t);
      sentimentRaw[i]![r.sentiment] += 1;
      const tt = bucketTopicCounts[i]!;
      tt.set(r.topicId, (tt.get(r.topicId) ?? 0) + 1);
      if (seriesIds.has(r.topicId)) {
        const key = String(r.topicId);
        volumeSeries[i]![key] = ((volumeSeries[i]![key] as number) ?? 0) + 1;
        topicSentimentSeries[key]![i]![r.sentiment] += 1;
      }
    }

    // Window totals per charted topic, summed from the per-bucket counts above.
    const topicSummaries: TrendTopicSummary[] = selectedIds.map((id) => {
      const totals = { negative: 0, neutral: 0, positive: 0 };
      for (const bucket of topicSentimentSeries[String(id)] ?? []) {
        totals.negative += bucket.negative;
        totals.neutral += bucket.neutral;
        totals.positive += bucket.positive;
      }
      return {
        id: String(id),
        mentions: totals.negative + totals.neutral + totals.positive,
        ...totals,
      };
    });

    const sentimentSeries: TrendSentimentPoint[] = bucketKeys.map((k, i) => {
      const raw = sentimentRaw[i]!;
      const counts = { negative: raw.negative, neutral: raw.neutral, positive: raw.positive };
      const total = raw.negative + raw.neutral + raw.positive;
      if (total === 0) return { label: cal.label(k, bkt), negative: 0, neutral: 0, positive: 0, counts };
      const negative = Math.round((raw.negative / total) * 100);
      const neutral = Math.round((raw.neutral / total) * 100);
      return { label: cal.label(k, bkt), negative, neutral, positive: 100 - negative - neutral, counts };
    });

    // Timeline: a topic's count in a bucket that is ≥ SPIKE_MIN_COUNT and at least
    // SPIKE_MIN_ABOVE above its average over the earlier buckets. Newest first.
    const spikes: FormTrend["timelineEvents"] = [];
    for (const id of topicIds) {
      let earlier = 0;
      bucketKeys.forEach((k, i) => {
        const n = bucketTopicCounts[i]!.get(id) ?? 0;
        const usual = i > 0 ? earlier / i : 0;
        if (i > 0 && n >= SPIKE_MIN_COUNT && n - usual >= SPIKE_MIN_ABOVE) {
          spikes.push({
            id: `spike-${id}-${i}`,
            date: new Date(k).toISOString(),
            description: `${nameOf(id)} spiked to ${n} mentions`,
            change: Math.round(n - usual),
            metricLabel: "more mentions than usual",
          });
        }
        earlier += n;
      });
    }
    const timelineEvents = spikes
      .sort((a, b) => b.date.localeCompare(a.date) || b.change - a.change)
      .slice(0, 5);

    return {
      bucket: bkt,
      rank,
      from: fromIso,
      to: toIso,
      rangeLabel,
      totalMentions,
      topicVolumeSeries,
      availableTopics,
      volumeSeries,
      topicSentimentSeries,
      topicSummaries,
      sentimentSeries,
      whatChanged,
      timelineEvents,
    };
  },
};
