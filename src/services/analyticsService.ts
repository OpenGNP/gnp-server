import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lte, max, min, sql } from "drizzle-orm";

import {
  answers,
  canonicalTopics,
  db,
  fieldOptions,
  formFields,
  forms,
  points,
  submissions,
} from "../db/client";
import { forbidden, notFound } from "../utils/errors";
import { parseDbTimestamp } from "../utils/timestamp";
import { createCalendar, resolveTimeZone, type Calendar } from "../utils/timezone";

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
  | { kind: "text"; id: string; title: string; responses: string[] };

type Sentiment = "negative" | "neutral" | "positive";

export type ThemeKeyword = { text: string; weight: 1 | 2 | 3 };

export type ThemeFeedbackPoint = {
  id: string;
  sentiment: Sentiment;
  /** The AI pipeline flagged this point as reporting a legal, ethical or moral breach. */
  severe: boolean;
  quote: string;
  originalFeedback: string;
  submittedAt: string;
  /** The respondent's answers to the form's demographic (single-choice) questions, in form order. */
  demographics: { label: string; value: string }[];
};

export type ThemeVolumePoint = { label: string; value: number };

export type ThemeTopic = {
  id: string;
  label: string;
  negative: number;
  neutral: number;
  positive: number;
  percentOfTotal: number;
  isHighIntensity: boolean;
  aiSummary: string;
  keywords: ThemeKeyword[];
  feedbackSegment: ThemeFeedbackPoint[];
  /** Mentions per bucket across the selected window (page filters applied); THEME_VOLUME_MIN_POINTS–MAX points. */
  volumeSeries: ThemeVolumePoint[];
};

/** The Trend tab's auto-bucketed charts get 6–12 x-axis points. */
const TREND_POINTS_MIN = 6;
const TREND_POINTS_MAX = 12;
/** The topic panel's volume chart gets 4–8 x-axis points. */
const THEME_VOLUME_MIN_POINTS = 4;
const THEME_VOLUME_MAX_POINTS = 8;

export type TopicMovementStatus = "existing" | "new" | "inactive";

/** One Rising / Declining row — mention COUNTS over two rolling windows ending at
 *  `to` (see MOVE_SPAN): current = the last N days, previous = the N days before. */
export type TopicMovement = {
  id: string;
  label: string;
  /** Mentions in the current window. */
  currentMentions: number;
  /** Mentions in the previous window. */
  previousMentions: number;
  /** currentMentions − previousMentions. Ranks the tables; |delta| ≥ MIN_DELTA to appear. */
  delta: number;
  status: TopicMovementStatus;
  /** Positive / negative mentions: current window count − previous window count. */
  positiveDelta: number;
  negativeDelta: number;
};

export type TrendBucket = "day" | "week" | "month" | "year";

/** How the topic picker ranks its list + which topics the chart auto-selects. */
export type TrendRank = "mentioned" | "severe";

/** One row of the Trend topic picker — every topic seen in the window, ranked. */
export type TrendAvailableTopic = {
  id: string;
  label: string;
  /** Mentions in the selected window. */
  mentions: number;
  /** Severe mentions in the selected window. */
  severe: number;
};

export type TrendVolumePoint = Record<string, number | string>;
export type TrendSentimentPoint = {
  label: string;
  negative: number;
  neutral: number;
  positive: number;
};

export type FormTrend = {
  bucket: TrendBucket;
  /** How `availableTopics` is ordered + how the chart auto-picked when `topics` wasn't given. */
  rank: TrendRank;
  /** The resolved window (ISO) — echoes back the caller's or the auto default. */
  from: string;
  to: string;
  rangeLabel: string;
  comparisonLabel: string;
  /** Analysed mentions for this form across ALL time — lets the UI tell "no data yet" from "range too narrow". */
  totalMentions: number;
  /** The lines currently on the chart. */
  topicVolumeSeries: { id: string; label: string }[];
  /** Every topic in the window, ranked by `rank` — powers the topic picker. */
  availableTopics: TrendAvailableTopic[];
  volumeSeries: TrendVolumePoint[];
  sentimentSeries: TrendSentimentPoint[];
  risingTopics: TopicMovement[];
  decliningTopics: TopicMovement[];
  emergingIssues: { id: string; title: string; description: string; riskLabel: string }[];
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
 * Default analytics window for a form (Trend + Themes tabs share this): the span of
 * its analysed feedback, first mention → last mention, so the tab opens on *all*
 * feedback. Deliberately NOT the form's start/end date — an admin can edit those
 * after responses land. Falls back to a trailing 90 days when the form has no
 * analysed feedback yet. Explicit from/to (epoch ms) win; a degenerate/inverted
 * result is widened to 90 days.
 */
function resolveFeedbackWindow(
  opts: { from?: number; to?: number },
  earliestMs: number,
  latestMs: number,
): { from: number; to: number; span: number } {
  const DEFAULT_SPAN = 90 * DAY_MS;
  const defaultTo = Number.isFinite(latestMs) ? latestMs : Date.now();
  const defaultFrom = Number.isFinite(earliestMs) ? earliestMs : defaultTo - DEFAULT_SPAN;
  const to = Number.isFinite(opts.to) ? (opts.to as number) : defaultTo;
  let from = Number.isFinite(opts.from) ? (opts.from as number) : defaultFrom;
  if (!(from < to)) from = to - DEFAULT_SPAN;
  return { from, to, span: Math.max(DAY_MS, to - from) };
}

const TREND_BUCKETS: readonly TrendBucket[] = ["day", "week", "month", "year"];
export const isTrendBucket = (v: string | undefined): v is TrendBucket =>
  v !== undefined && (TREND_BUCKETS as readonly string[]).includes(v);

const TREND_RANKS: readonly TrendRank[] = ["mentioned", "severe"];
export const isTrendRank = (v: string | undefined): v is TrendRank =>
  v !== undefined && (TREND_RANKS as readonly string[]).includes(v);

/** Default line count when the chart auto-picks; hard cap when the caller picks. */
const TREND_SERIES_DEFAULT = 5;
const TREND_SERIES_MAX = 8;
/** Rows sent to the picker — beyond this, topics have negligible volume anyway. */
const TREND_AVAILABLE_LIMIT = 500;

/** Rising / Declining + Emerging Issues window length per bucket unit (N days). */
const MOVE_SPAN: Record<TrendBucket, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};
const MOVE_WORDING: Record<TrendBucket, { last: string; before: string }> = {
  day: { last: "in the last day", before: "the day before" },
  week: { last: "in the last 7 days", before: "the week before" },
  month: { last: "in the last 30 days", before: "the 30 days before" },
  year: { last: "in the last 365 days", before: "the year before" },
};
/** Rising needs delta ≥ this; declining delta ≤ −this. */
const MIN_DELTA = 2;
/** Emerging issue (non-severe): at least this many negatives in the current window. */
const EMERGING_MIN_NEGATIVE = 3;
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

async function assertFormOwner(formId: number, adminId: number) {
  const [form] = await db
    .select({ id: forms.id, adminId: forms.adminId, title: forms.formTitle })
    .from(forms)
    .where(eq(forms.id, formId))
    .limit(1);

  if (!form) throw notFound("Form not found");
  if (form.adminId !== adminId) throw forbidden("You do not have access to this form");
  return form;
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

    const [severeCount] = await db
      .select({ value: count() })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .where(and(eq(forms.adminId, adminId), eq(points.isSevere, true)));

    const [topicsCount] = await db
      .select({ value: count() })
      .from(canonicalTopics)
      .where(eq(canonicalTopics.status, "active"));

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
      severeIssues: severeCount?.value ?? 0,
      sentimentBreakdown,
    };
  },

  /** Weekly per-topic feedback counts, computed from `points` (newest week first). */
  async trends(limit = 20) {
    const periodStart = sql<string>`date_trunc('week', ${points.createdAt})`;

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
        severeCount: sql<number>`count(*) filter (where ${points.isSevere})`.mapWith(Number),
      })
      .from(points)
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
    await assertFormOwner(formId, adminId);

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
      .select({ value: count() })
      .from(submissions)
      .where(eq(submissions.formId, formId));
    const totalResponses = totals?.value ?? 0;

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
      .select({ fieldId: answers.fieldId, text: answers.answerText })
      .from(answers)
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
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
            .map((row) => row.text as string),
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

    return { totalResponses, demographic, feedback };
  },

  /**
   * Theme analysis for one form's Dashboard "Themes" tab: overall sentiment, the
   * canonical topics its analysed feedback maps to (per-topic sentiment split,
   * keywords, and a demographic-tagged sample of feedback points), and the
   * high-intensity subset. Trend line in the detail panel is synthetic client-side.
   */
  async formThemes(
    formId: number,
    adminId: number,
    opts: { from?: number; to?: number; demo?: Record<string, string[]>; timeZone?: string } = {},
  ) {
    const form = await assertFormOwner(formId, adminId);
    const cal = createCalendar(resolveTimeZone(opts.timeZone));

    // Resolve the analysis window the same way the Trend tab does: default to the
    // span of this form's analysed feedback, explicit from/to win.
    const [allTime] = await db
      .select({
        value: count(),
        earliest: min(submissions.createdAt),
        latest: max(submissions.createdAt),
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(and(eq(submissions.formId, formId), isNotNull(points.canonicalTopicId)));
    const totalMentions = allTime?.value ?? 0;
    const earliestMs = allTime?.earliest ? parseTs(allTime.earliest) : NaN;
    const latestMs = allTime?.latest ? parseTs(allTime.latest) : NaN;
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
        sentiment: points.sentimentLabel,
        severe: points.isSevere,
        pointText: points.pointText,
        originalFeedback: answers.answerText,
        submissionId: submissions.id,
        submittedAt: submissions.createdAt,
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
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

    // Responders (same date + demographic filters) in the last 7 days of the selected
    // window. Called "this week" when the window runs up to now; otherwise it's the
    // window's final week, so the label says so rather than implying "now".
    const weekStart = Math.max(from, to - 7 * DAY_MS);
    const recentResponders = matchingSubmissions.filter((row) => {
      const t = row.createdAt ? parseTs(row.createdAt) : NaN;
      return t >= weekStart && t <= to;
    }).length;
    const windowEndsNow = Date.now() - to < DAY_MS;
    const responderDeltaLabel = `+${recentResponders} ${windowEndsNow ? "this week" : "in final week"}`;

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
    const assignedTotal = assigned.length || 1;
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

    const volume = volumeBuckets(cal, from, to, THEME_VOLUME_MIN_POINTS, THEME_VOLUME_MAX_POINTS);
    const bucketIndexOf = (iso: string | null) => {
      const t = iso ? parseTs(iso) : NaN;
      if (Number.isNaN(t)) return -1;
      let index = -1;
      for (let i = 0; i < volume.starts.length && volume.starts[i]! <= t; i += 1) index = i;
      return index;
    };

    const topics: ThemeTopic[] = topicIds.map((topicId) => {
      const meta = metaById.get(topicId);
      const rows = assigned.filter((row) => row.topicId === topicId);
      const counts: Record<Sentiment, number> = { negative: 0, neutral: 0, positive: 0 };
      let severe = 0;
      for (const row of rows) {
        counts[row.sentiment as Sentiment] += 1;
        if (row.severe) severe += 1;
      }

      const volumeCounts = volume.starts.map(() => 0);
      for (const row of rows) {
        const index = bucketIndexOf(row.submittedAt);
        if (index >= 0) volumeCounts[index]! += 1;
      }

      // Every point in the topic, not a sample — the panel has its own sort and filter.
      const feedbackSegment: ThemeFeedbackPoint[] = rows.map((row) => ({
        id: String(row.id),
        sentiment: row.sentiment as Sentiment,
        severe: Boolean(row.severe),
        quote: row.pointText ?? "",
        originalFeedback: row.originalFeedback ?? row.pointText ?? "",
        submittedAt: row.submittedAt ?? new Date().toISOString(),
        demographics: [...(demoBySubmission.get(row.submissionId) ?? [])]
          .sort((a, b) => a.order - b.order)
          .map((entry) => ({ label: entry.label, value: entry.value || "Unspecified" })),
      }));

      return {
        id: String(topicId),
        label: meta?.name ?? "Untitled topic",
        negative: counts.negative,
        neutral: counts.neutral,
        positive: counts.positive,
        percentOfTotal: Math.round((rows.length / assignedTotal) * 1000) / 10,
        isHighIntensity: severe > 0,
        aiSummary: meta?.summary ?? "",
        keywords: parseKeywords(meta?.keywords ?? null),
        feedbackSegment,
        volumeSeries: volume.starts.map((start, i) => ({
          label: cal.label(start, volume.bucket),
          value: volumeCounts[i]!,
        })),
      };
    });

    topics.sort(
      (a, b) =>
        b.negative + b.neutral + b.positive - (a.negative + a.neutral + a.positive),
    );

    return {
      title: `Discovered Themes of ${form.title ?? "this form"}`,
      from: fromIso,
      to: toIso,
      rangeLabel,
      /** Analysed mentions across ALL time — lets the UI tell "none yet" from "none in range". */
      totalMentions,
      totalResponders,
      responderDelta: recentResponders,
      responderDeltaLabel,
      demographicFilters,
      sentiment,
      highIntenseTopics: topics.filter((topic) => topic.isHighIntensity),
      aiDiscoveredTopics: topics,
    };
  },

  /**
   * Trend tab for one form, over a caller-chosen time range + bucket granularity
   * (day / week / month / year). Buckets the form's analysed feedback into a real
   * time series — `volumeSeries` (per charted topic) and `sentimentSeries` (% per
   * bucket). Rising / Declining and Emerging Issues compare mention counts in two
   * rolling windows ending at `to`: the last N days vs the N days before (N from
   * MOVE_SPAN). The Timeline lists topic spikes within the chart buckets.
   *
   * Which topics get a line: `topics` (explicit ids from the picker, cap 8) wins;
   * otherwise the top 5 by `rank` (mentioned / severe) that clear a small volume
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
    await assertFormOwner(formId, adminId);
    const cal = createCalendar(resolveTimeZone(opts.timeZone));

    // Analysed mentions for this form across all time + when the first/last one landed —
    // used for `totalMentions` and to anchor the default window on real data.
    const [allTime] = await db
      .select({
        value: count(),
        earliest: min(submissions.createdAt),
        latest: max(submissions.createdAt),
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(and(eq(submissions.formId, formId), isNotNull(points.canonicalTopicId)));
    const totalMentions = allTime?.value ?? 0;
    const earliestMs = allTime?.earliest ? parseTs(allTime.earliest) : NaN;
    const latestMs = allTime?.latest ? parseTs(allTime.latest) : NaN;

    // Default window = the span of this form's analysed feedback (see
    // resolveFeedbackWindow). Explicit from/to from the date filter always win.
    const window = resolveFeedbackWindow(opts, earliestMs, latestMs);
    const { from, span } = window;
    // `to` = the end of the last selected day, so the rolling windows below cover whole
    // days. The date filter already sends 23:59:59.999; the default ends at the last mention.
    const to = Number.isFinite(opts.to) ? window.to : cal.next(cal.start(window.to, "day"), "day") - 1;
    // No explicit bucket = "auto": pick a step that gives the charts 6–12 x-axis points
    // (it can span several units, e.g. 2 weeks). `bkt` is then that step's unit, which
    // the rising/declining comparison below keeps using.
    const autoVolume = opts.bucket ? null : volumeBuckets(cal, from, to, TREND_POINTS_MIN, TREND_POINTS_MAX);
    const bkt: TrendBucket = opts.bucket ?? autoVolume!.bucket;
    const rank: TrendRank = opts.rank ?? "mentioned";
    // Rising / Declining + Emerging Issues: current = (to − N, to], previous = the N
    // before that. The row fetch below is widened to cover the previous window.
    const moveSpan = MOVE_SPAN[bkt];
    const wording = MOVE_WORDING[bkt];
    const prevFrom = Math.min(from - span, to - 2 * moveSpan);

    const rangeLabel = `${cal.date(from)} – ${cal.date(to)}`;
    const comparisonLabel = `${wording.last.replace(/^in the /, "")} vs ${wording.before}`;
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();

    const empty: FormTrend = {
      bucket: bkt,
      rank,
      from: fromIso,
      to: toIso,
      rangeLabel,
      comparisonLabel,
      totalMentions,
      topicVolumeSeries: [],
      availableTopics: [],
      volumeSeries: [],
      sentimentSeries: [],
      risingTopics: [],
      decliningTopics: [],
      emergingIssues: [],
      timelineEvents: [],
    };

    // Analysed points from the previous window's start through the selected `to`.
    const rows = await db
      .select({
        topicId: points.canonicalTopicId,
        sentiment: points.sentimentLabel,
        severe: points.isSevere,
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

    // Demographic filter applies to everything below: series, picker, rising/declining.
    const { matchesDemo, isFiltering } = opts.demo
      ? await loadDemographics(formId, opts.demo)
      : { matchesDemo: () => true, isFiltering: false };

    type CleanRow = { topicId: number; sentiment: Sentiment; severe: boolean; t: number };
    const clean: CleanRow[] = [];
    for (const row of rows) {
      if (isFiltering && !matchesDemo(row.submissionId)) continue;
      const t = parseTs(row.submittedAt as string);
      if (Number.isNaN(t) || row.topicId === null || !isSentiment(row.sentiment)) continue;
      clean.push({ topicId: row.topicId, sentiment: row.sentiment, severe: Boolean(row.severe), t });
    }
    if (clean.length === 0) return empty;

    const current = clean.filter((r) => r.t >= from);
    // Bounded explicitly (not just "< from") since the row fetch below is widened
    // to also cover the movement comparison windows, which can reach further back
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
    type Tally = { total: number; neg: number; pos: number; severe: number };
    const tallyBy = (list: CleanRow[]) => {
      const map = new Map<number, Tally>();
      for (const r of list) {
        const t = map.get(r.topicId) ?? { total: 0, neg: 0, pos: 0, severe: 0 };
        t.total += 1;
        if (r.sentiment === "negative") t.neg += 1;
        if (r.sentiment === "positive") t.pos += 1;
        if (r.severe) t.severe += 1;
        map.set(r.topicId, t);
      }
      return map;
    };
    const cur = tallyBy(current);
    const prev = tallyBy(previous);
    const zero: Tally = { total: 0, neg: 0, pos: 0, severe: 0 };

    // --- Rising / Declining: counts in the two rolling windows ---------------
    const moveCur = tallyBy(clean.filter((r) => r.t > to - moveSpan && r.t <= to));
    const movePrev = tallyBy(clean.filter((r) => r.t > to - 2 * moveSpan && r.t <= to - moveSpan));
    const seenBefore = new Set(clean.filter((r) => r.t <= to - moveSpan).map((r) => r.topicId));

    const movements: TopicMovement[] = topicIds.map((id) => {
      const c = moveCur.get(id) ?? zero;
      const p = movePrev.get(id) ?? zero;
      const status: TopicMovementStatus = seenBefore.has(id) ? "existing" : c.total > 0 ? "new" : "inactive";
      return {
        id: String(id),
        label: nameOf(id),
        currentMentions: c.total,
        previousMentions: p.total,
        delta: c.total - p.total,
        status,
        positiveDelta: c.pos - p.pos,
        negativeDelta: c.neg - p.neg,
      };
    });

    const risingTopics = movements
      .filter((m) => m.delta >= MIN_DELTA)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 5);
    const decliningTopics = movements
      .filter((m) => m.delta <= -MIN_DELTA)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 5);

    // --- topic picker: rank every in-window topic ---------------------------
    const rankScore = (id: number): number => {
      const c = cur.get(id) ?? zero;
      return rank === "severe" ? c.severe * 100_000 + c.neg : c.total; // else "mentioned"
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
        severe: cur.get(id)?.severe ?? 0,
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

    // Emerging issues: a severe mention in the current window, or negatives ≥ 3 that are
    // at least double the previous window's and up by at least 2.
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    const emergingIssues = topicIds
      .map((id) => ({ id, cur: moveCur.get(id) ?? zero, prev: movePrev.get(id) ?? zero }))
      .filter(
        ({ cur: c, prev: p }) =>
          c.severe > 0 || (c.neg >= EMERGING_MIN_NEGATIVE && c.neg >= Math.max(2 * p.neg, p.neg + 2)),
      )
      .sort((a, b) => b.cur.severe - a.cur.severe || b.cur.neg - b.prev.neg - (a.cur.neg - a.prev.neg))
      .slice(0, 3)
      .map(({ id, cur: c, prev: p }) => ({
        id: String(id),
        title: nameOf(id),
        description:
          c.severe > 0
            ? `${plural(c.severe, "severe report")} ${wording.last}`
            : `${plural(c.neg, "negative mention")} ${wording.last} (${p.neg} ${wording.before})`,
        riskLabel: c.severe > 0 ? "Critical" : "High",
      }));

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

    for (const r of current) {
      const i = idxFor(r.t);
      sentimentRaw[i]![r.sentiment] += 1;
      const tt = bucketTopicCounts[i]!;
      tt.set(r.topicId, (tt.get(r.topicId) ?? 0) + 1);
      if (seriesIds.has(r.topicId)) {
        const key = String(r.topicId);
        volumeSeries[i]![key] = ((volumeSeries[i]![key] as number) ?? 0) + 1;
      }
    }

    const sentimentSeries: TrendSentimentPoint[] = bucketKeys.map((k, i) => {
      const raw = sentimentRaw[i]!;
      const total = raw.negative + raw.neutral + raw.positive;
      if (total === 0) return { label: cal.label(k, bkt), negative: 0, neutral: 0, positive: 0 };
      const negative = Math.round((raw.negative / total) * 100);
      const neutral = Math.round((raw.neutral / total) * 100);
      return { label: cal.label(k, bkt), negative, neutral, positive: 100 - negative - neutral };
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
      comparisonLabel,
      totalMentions,
      topicVolumeSeries,
      availableTopics,
      volumeSeries,
      sentimentSeries,
      risingTopics,
      decliningTopics,
      emergingIssues,
      timelineEvents,
    };
  },
};
