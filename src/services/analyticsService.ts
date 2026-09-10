import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";

import {
  answers,
  canonicalTopics,
  db,
  fieldOptions,
  formFields,
  forms,
  points,
  submissions,
  topicTrends,
} from "../db/client";
import { forbidden, notFound } from "../utils/errors";

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
  quote: string;
  originalFeedback: string;
  submittedAt: string;
  /** The respondent's answers to the form's demographic (single-choice) questions, in form order. */
  demographics: { label: string; value: string }[];
};

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
};

export type TopicMovement = {
  id: string;
  label: string;
  volumeChange: number;
  positiveChange: number;
  negativeChange: number;
};

export type TrendBucket = "day" | "week" | "month" | "year";

export type TrendVolumePoint = Record<string, number | string>;
export type TrendSentimentPoint = {
  label: string;
  negative: number;
  neutral: number;
  positive: number;
};

export type FormTrend = {
  bucket: TrendBucket;
  rangeLabel: string;
  comparisonLabel: string;
  /** Analysed mentions for this form across ALL time — lets the UI tell "no data yet" from "range too narrow". */
  totalMentions: number;
  topicVolumeSeries: { id: string; label: string }[];
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

/** Zone-less DB timestamp → epoch ms, read as UTC (columns are `timestamp` without tz). */
const parseTs = (value: string): number =>
  Date.parse(/Z$|[+-]\d\d(:?\d\d)?$/.test(value) ? value : `${value.replace(" ", "T")}Z`);

const TREND_BUCKETS: readonly TrendBucket[] = ["day", "week", "month", "year"];
export const isTrendBucket = (v: string | undefined): v is TrendBucket =>
  v !== undefined && (TREND_BUCKETS as readonly string[]).includes(v);

/** Pick a bucket size from the window span when the caller doesn't specify one. */
function autoBucket(spanMs: number): TrendBucket {
  const days = spanMs / DAY_MS;
  if (days <= 21) return "day";
  if (days <= 120) return "week";
  if (days <= 800) return "month";
  return "year";
}

/** Start-of-period (UTC) for `ms` — day, ISO week (Mon), calendar month, or calendar year. */
function bucketStart(ms: number, b: TrendBucket): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (b === "day") return Date.UTC(y, m, day);
  if (b === "week") {
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    return Date.UTC(y, m, day + (dow === 0 ? -6 : 1 - dow));
  }
  if (b === "month") return Date.UTC(y, m, 1);
  return Date.UTC(y, 0, 1);
}

function bucketNext(ms: number, b: TrendBucket): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  if (b === "day") return Date.UTC(y, m, day + 1);
  if (b === "week") return Date.UTC(y, m, day + 7);
  if (b === "month") return Date.UTC(y, m + 1, 1);
  return Date.UTC(y + 1, 0, 1);
}

function bucketLabel(ms: number, b: TrendBucket): string {
  const d = new Date(ms);
  if (b === "year") return String(d.getUTCFullYear());
  if (b === "month")
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const humanSpan = (spanMs: number): string => {
  const days = Math.max(1, Math.round(spanMs / DAY_MS));
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365 * 1.5) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
};

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

  async trends(limit = 20) {
    return db
      .select({
        id: topicTrends.id,
        topicId: topicTrends.canonicalTopicId,
        topicName: canonicalTopics.canonicalName,
        periodStart: topicTrends.periodStart,
        periodEnd: topicTrends.periodEnd,
        feedbackCount: topicTrends.feedbackCount,
        positiveCount: topicTrends.positiveCount,
        neutralCount: topicTrends.neutralCount,
        negativeCount: topicTrends.negativeCount,
        severeCount: topicTrends.severeCount,
      })
      .from(topicTrends)
      .innerJoin(canonicalTopics, eq(topicTrends.canonicalTopicId, canonicalTopics.id))
      .orderBy(desc(topicTrends.periodEnd))
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
      const title = field.label ?? "Untitled question";

      if (field.type === "radio" || field.type === "checkbox") {
        const opts = (optionsByField.get(field.id) ?? []).map((option) => ({
          id: String(option.id),
          label: option.label ?? "",
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
  async formThemes(formId: number, adminId: number) {
    const form = await assertFormOwner(formId, adminId);

    const [totals] = await db
      .select({ value: count() })
      .from(submissions)
      .where(eq(submissions.formId, formId));
    const totalResponders = totals?.value ?? 0;

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [recent] = await db
      .select({ value: count() })
      .from(submissions)
      .where(and(eq(submissions.formId, formId), gte(submissions.createdAt, weekAgo)));
    const recentResponders = recent?.value ?? 0;

    // Every analysed point for this form, with its source answer text + submission.
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
      .where(eq(submissions.formId, formId))
      .orderBy(desc(submissions.createdAt));

    // Overall sentiment (every point, assigned to a topic or not).
    const overall: Record<Sentiment, number> = { negative: 0, neutral: 0, positive: 0 };
    for (const row of pointRows) {
      if (isSentiment(row.sentiment)) overall[row.sentiment] += 1;
    }
    const overallTotal = overall.negative + overall.neutral + overall.positive || 1;
    const pct = (value: number) => Math.round((value / overallTotal) * 100);
    const sentiment = {
      score:
        Math.round(
          ((overall.positive * 5 + overall.neutral * 3 + overall.negative) / overallTotal) * 10,
        ) / 10,
      outOf: 5,
      negative: pct(overall.negative),
      neutral: pct(overall.neutral),
      positive: pct(overall.positive),
    };

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

    const FEEDBACK_SAMPLE = 15;
    const topics: ThemeTopic[] = topicIds.map((topicId) => {
      const meta = metaById.get(topicId);
      const rows = assigned.filter((row) => row.topicId === topicId);
      const counts: Record<Sentiment, number> = { negative: 0, neutral: 0, positive: 0 };
      let severe = 0;
      for (const row of rows) {
        counts[row.sentiment as Sentiment] += 1;
        if (row.severe) severe += 1;
      }
      const topicTotal = rows.length || 1;

      const feedbackSegment: ThemeFeedbackPoint[] = rows.slice(0, FEEDBACK_SAMPLE).map((row) => ({
        id: String(row.id),
        sentiment: row.sentiment as Sentiment,
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
        isHighIntensity: severe > 0 || (counts.negative / topicTotal >= 0.5 && rows.length >= 3),
        aiSummary: meta?.summary ?? "",
        keywords: parseKeywords(meta?.keywords ?? null),
        feedbackSegment,
      };
    });

    topics.sort(
      (a, b) =>
        b.negative + b.neutral + b.positive - (a.negative + a.neutral + a.positive),
    );

    return {
      title: `Discovered Themes of ${form.title ?? "this form"}`,
      totalResponders,
      responderDeltaLabel: `+${recentResponders} this week`,
      sentiment,
      highIntenseTopics: topics.filter((topic) => topic.isHighIntensity),
      aiDiscoveredTopics: topics,
    };
  },

  /**
   * Trend tab for one form, over a caller-chosen time range + bucket granularity
   * (day / week / month / year). Buckets the form's analysed feedback into a real
   * time series — `volumeSeries` (per top topic) and `sentimentSeries` (% per
   * bucket) — and compares the selected window against the immediately-preceding
   * equal window for the Rising / Declining tables (plain stock-style % change).
   */
  async formTrend(
    formId: number,
    adminId: number,
    opts: { from?: number; to?: number; bucket?: TrendBucket } = {},
  ): Promise<FormTrend> {
    await assertFormOwner(formId, adminId);

    const to = Number.isFinite(opts.to) ? (opts.to as number) : Date.now();
    const from =
      Number.isFinite(opts.from) && (opts.from as number) < to
        ? (opts.from as number)
        : to - 90 * DAY_MS;
    const span = Math.max(DAY_MS, to - from);
    const bkt: TrendBucket = opts.bucket ?? autoBucket(span);
    const prevFrom = from - span;

    const fmtDate = (t: number) =>
      new Date(t).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    const rangeLabel = `${fmtDate(from)} – ${fmtDate(to)}`;
    const comparisonLabel = `vs previous ${humanSpan(span)}`;

    // Analysed mentions for this form across all time (regardless of the window).
    const [allTime] = await db
      .select({ value: count() })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .innerJoin(submissions, eq(answers.submissionId, submissions.id))
      .where(and(eq(submissions.formId, formId), isNotNull(points.canonicalTopicId)));
    const totalMentions = allTime?.value ?? 0;

    const empty: FormTrend = {
      bucket: bkt,
      rangeLabel,
      comparisonLabel,
      totalMentions,
      topicVolumeSeries: [],
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

    type CleanRow = { topicId: number; sentiment: Sentiment; severe: boolean; t: number };
    const clean: CleanRow[] = [];
    for (const row of rows) {
      const t = parseTs(row.submittedAt as string);
      if (Number.isNaN(t) || row.topicId === null || !isSentiment(row.sentiment)) continue;
      clean.push({ topicId: row.topicId, sentiment: row.sentiment, severe: Boolean(row.severe), t });
    }
    if (clean.length === 0) return empty;

    const current = clean.filter((r) => r.t >= from);
    const previous = clean.filter((r) => r.t < from);
    const topicIds = [...new Set(current.map((r) => r.topicId))];
    if (topicIds.length === 0) return empty;

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
    const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

    const movements: TopicMovement[] = topicIds.map((id) => {
      const c = cur.get(id) ?? zero;
      const p = prev.get(id) ?? zero;
      // Stock-style: (now − before) / before, uncapped up, floored at −100% down;
      // from a zero baseline each new mention counts as +100%.
      const volumeChange =
        p.total > 0 ? Math.round(((c.total - p.total) / p.total) * 100) : c.total * 100;
      return {
        id: String(id),
        label: nameOf(id),
        volumeChange,
        positiveChange: Math.round(share(c.pos, c.total) - share(p.pos, p.total)),
        negativeChange: Math.round(share(c.neg, c.total) - share(p.neg, p.total)),
      };
    });

    const risingTopics = movements
      .filter((m) => m.volumeChange > 0)
      .sort((a, b) => b.volumeChange - a.volumeChange)
      .slice(0, 5);
    const decliningTopics = movements
      .filter((m) => m.volumeChange < 0)
      .sort((a, b) => a.volumeChange - b.volumeChange)
      .slice(0, 5);

    const topicVolumeSeries = [...topicIds]
      .sort((a, b) => (cur.get(b)?.total ?? 0) - (cur.get(a)?.total ?? 0))
      .slice(0, 5)
      .map((id) => ({ id: String(id), label: nameOf(id) }));
    const seriesIds = new Set(topicVolumeSeries.map((s) => Number(s.id)));

    const emergingIssues = movements
      .filter((m) => (cur.get(Number(m.id))?.severe ?? 0) > 0 || m.negativeChange >= 15)
      .sort(
        (a, b) =>
          (cur.get(Number(b.id))?.severe ?? 0) - (cur.get(Number(a.id))?.severe ?? 0) ||
          b.negativeChange - a.negativeChange,
      )
      .slice(0, 3)
      .map((m) => {
        const severe = cur.get(Number(m.id))?.severe ?? 0;
        return {
          id: m.id,
          title: m.label,
          description:
            severe > 0
              ? `${severe} severe report${severe === 1 ? "" : "s"} flagged this period`
              : `Negative mentions up ${m.negativeChange}% vs the previous ${humanSpan(span)}`,
          riskLabel: severe > 0 ? "Critical" : "High",
        };
      });

    // --- real time series over the selected window --------------------------
    const bucketKeys: number[] = [];
    for (
      let k = bucketStart(from, bkt);
      k <= to && bucketKeys.length < 400;
      k = bucketNext(k, bkt)
    ) {
      bucketKeys.push(k);
    }
    if (bucketKeys.length === 0) bucketKeys.push(bucketStart(from, bkt));
    const keyIndex = new Map(bucketKeys.map((k, i) => [k, i]));
    const idxFor = (t: number) =>
      keyIndex.get(bucketStart(t, bkt)) ??
      (t < bucketKeys[0]! ? 0 : bucketKeys.length - 1);

    const volumeSeries: TrendVolumePoint[] = bucketKeys.map((k) => {
      const point: TrendVolumePoint = { label: bucketLabel(k, bkt) };
      for (const id of seriesIds) point[String(id)] = 0;
      return point;
    });
    const sentimentRaw = bucketKeys.map(() => ({ negative: 0, neutral: 0, positive: 0 }));
    const bucketTotals = new Array<number>(bucketKeys.length).fill(0);
    const bucketTopTopic = bucketKeys.map(() => new Map<number, number>());

    for (const r of current) {
      const i = idxFor(r.t);
      bucketTotals[i] = (bucketTotals[i] ?? 0) + 1;
      sentimentRaw[i]![r.sentiment] += 1;
      const tt = bucketTopTopic[i]!;
      tt.set(r.topicId, (tt.get(r.topicId) ?? 0) + 1);
      if (seriesIds.has(r.topicId)) {
        const key = String(r.topicId);
        volumeSeries[i]![key] = ((volumeSeries[i]![key] as number) ?? 0) + 1;
      }
    }

    const sentimentSeries: TrendSentimentPoint[] = bucketKeys.map((k, i) => {
      const raw = sentimentRaw[i]!;
      const total = raw.negative + raw.neutral + raw.positive;
      if (total === 0) return { label: bucketLabel(k, bkt), negative: 0, neutral: 0, positive: 0 };
      const negative = Math.round((raw.negative / total) * 100);
      const neutral = Math.round((raw.neutral / total) * 100);
      return { label: bucketLabel(k, bkt), negative, neutral, positive: 100 - negative - neutral };
    });

    const timelineEvents = bucketTotals
      .map((total, i) => {
        const before = i > 0 ? bucketTotals[i - 1]! : 0;
        const change =
          before > 0
            ? Math.round(((total - before) / before) * 100)
            : i > 0 && total > 0
              ? total * 100
              : 0;
        let topId = 0;
        let topCount = -1;
        for (const [tid, c] of bucketTopTopic[i]!) {
          if (c > topCount) {
            topCount = c;
            topId = tid;
          }
        }
        return {
          id: `bucket-${i}`,
          date: new Date(bucketKeys[i]!).toISOString(),
          description: `${topId ? nameOf(topId) : "Feedback"} was the most-discussed topic`,
          change,
          metricLabel: `mentions per ${bkt}`,
        };
      })
      .filter((event) => event.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 4);

    return {
      bucket: bkt,
      rangeLabel,
      comparisonLabel,
      totalMentions,
      topicVolumeSeries,
      volumeSeries,
      sentimentSeries,
      risingTopics,
      decliningTopics,
      emergingIssues,
      timelineEvents,
    };
  },
};
