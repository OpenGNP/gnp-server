import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

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

export type FormTrend = {
  rangeLabel: string;
  comparisonLabel: string;
  topicVolumeSeries: { id: string; label: string }[];
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
   * Trend tab for one form. Splits the form's feedback window in half and compares
   * topic volume + sentiment share between the two halves. The two line charts in
   * `TrendView` stay client-synthetic (a sparse real daily series would look worse);
   * this powers the Rising/Declining tables, Emerging Issues, Timeline, and the chart
   * series labels.
   */
  async formTrend(formId: number, adminId: number): Promise<FormTrend> {
    await assertFormOwner(formId, adminId);

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
        ),
      );

    const empty: FormTrend = {
      rangeLabel: "No data yet",
      comparisonLabel: "",
      topicVolumeSeries: [],
      risingTopics: [],
      decliningTopics: [],
      emergingIssues: [],
      timelineEvents: [],
    };
    if (rows.length === 0) return empty;

    const times = rows.map((row) => parseTs(row.submittedAt as string)).filter((n) => !Number.isNaN(n));
    if (times.length === 0) return empty;
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const midT = minT + (maxT - minT) / 2;
    const windowDays = Math.max(1, Math.round((maxT - minT) / DAY_MS));

    const topicIds = [...new Set(rows.map((row) => row.topicId as number))];
    const meta =
      topicIds.length > 0
        ? await db
            .select({ id: canonicalTopics.id, name: canonicalTopics.canonicalName })
            .from(canonicalTopics)
            .where(inArray(canonicalTopics.id, topicIds))
        : [];
    const nameById = new Map(meta.map((row) => [row.id, row.name ?? "Untitled topic"]));

    type Bucket = { total: number; neg: number; pos: number; severe: number };
    const bucket = (): Bucket => ({ total: 0, neg: 0, pos: 0, severe: 0 });
    const first = new Map<number, Bucket>();
    const second = new Map<number, Bucket>();
    const overall = new Map<number, Bucket>();
    const add = (map: Map<number, Bucket>, topicId: number, row: (typeof rows)[number]) => {
      const b = map.get(topicId) ?? bucket();
      b.total += 1;
      if (row.sentiment === "negative") b.neg += 1;
      if (row.sentiment === "positive") b.pos += 1;
      if (row.severe) b.severe += 1;
      map.set(topicId, b);
    };
    for (const row of rows) {
      const t = parseTs(row.submittedAt as string);
      if (Number.isNaN(t)) continue;
      const topicId = row.topicId as number;
      add(t < midT ? first : second, topicId, row);
      add(overall, topicId, row);
    }

    const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

    const movements: TopicMovement[] = topicIds.map((id) => {
      const b1 = first.get(id) ?? bucket();
      const b2 = second.get(id) ?? bucket();
      const volumeChange =
        b1.total > 0
          ? Math.round(((b2.total - b1.total) / b1.total) * 100)
          : b2.total > 0
            ? 100
            : 0;
      return {
        id: String(id),
        label: nameById.get(id) ?? "Untitled topic",
        volumeChange,
        positiveChange: Math.round(share(b2.pos, b2.total) - share(b1.pos, b1.total)),
        negativeChange: Math.round(share(b2.neg, b2.total) - share(b1.neg, b1.total)),
      };
    });

    const totalOf = (id: string) => overall.get(Number(id))?.total ?? 0;
    const severeOf = (id: string) => overall.get(Number(id))?.severe ?? 0;

    const topicVolumeSeries = [...movements]
      .sort((a, b) => totalOf(b.id) - totalOf(a.id))
      .slice(0, 5)
      .map(({ id, label }) => ({ id, label }));

    const risingTopics = movements
      .filter((m) => m.volumeChange > 0)
      .sort((a, b) => b.volumeChange - a.volumeChange)
      .slice(0, 5);
    const decliningTopics = movements
      .filter((m) => m.volumeChange < 0)
      .sort((a, b) => a.volumeChange - b.volumeChange)
      .slice(0, 5);

    const emergingIssues = movements
      .filter((m) => severeOf(m.id) > 0 || m.negativeChange >= 15)
      .sort((a, b) => severeOf(b.id) - severeOf(a.id) || b.negativeChange - a.negativeChange)
      .slice(0, 3)
      .map((m) => {
        const severe = severeOf(m.id);
        return {
          id: m.id,
          title: m.label,
          description:
            severe > 0
              ? `${severe} severe report${severe === 1 ? "" : "s"} flagged in this topic`
              : `Negative mentions up ${m.negativeChange}% vs the earlier period`,
          riskLabel: severe > 0 ? "Critical" : "High",
        };
      });

    // Weekly volume buckets → biggest week-over-week jumps for the timeline.
    const WEEK_MS = 7 * DAY_MS;
    const weekCount = Math.max(1, Math.ceil((maxT - minT) / WEEK_MS));
    const weekTotals = new Array<number>(weekCount).fill(0);
    const weekTopic = new Map<number, Map<number, number>>();
    for (const row of rows) {
      const t = parseTs(row.submittedAt as string);
      if (Number.isNaN(t)) continue;
      const idx = Math.min(weekCount - 1, Math.floor((t - minT) / WEEK_MS));
      weekTotals[idx] = (weekTotals[idx] ?? 0) + 1;
      const wk = weekTopic.get(idx) ?? new Map<number, number>();
      wk.set(row.topicId as number, (wk.get(row.topicId as number) ?? 0) + 1);
      weekTopic.set(idx, wk);
    }

    const timelineEvents = weekTotals
      .map((total, idx) => {
        const prev = idx > 0 ? weekTotals[idx - 1]! : 0;
        const change =
          prev > 0 ? Math.round(((total - prev) / prev) * 100) : idx > 0 && total > 0 ? 100 : 0;
        let topId = 0;
        let topCount = -1;
        for (const [tid, c] of weekTopic.get(idx) ?? []) {
          if (c > topCount) {
            topCount = c;
            topId = tid;
          }
        }
        return {
          id: `week-${idx}`,
          date: new Date(minT + (idx + 1) * WEEK_MS).toISOString(),
          description: `${nameById.get(topId) ?? "Feedback"} was the most-discussed topic`,
          change,
          metricLabel: "weekly mentions",
        };
      })
      .filter((event) => event.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 4);

    const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
    return {
      rangeLabel: `Last ${windowDays} days`,
      comparisonLabel: `vs ${fmt(minT)} – ${fmt(midT)}`,
      topicVolumeSeries,
      risingTopics,
      decliningTopics,
      emergingIssues,
      timelineEvents,
    };
  },
};
