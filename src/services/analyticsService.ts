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
  department: string;
  year: string;
  gender: string;
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

    // Demographic context per submission — radio demographic answers, matched by label.
    const demoRows = await db
      .select({
        submissionId: answers.submissionId,
        label: formFields.fieldLabel,
        option: fieldOptions.optionLabel,
      })
      .from(answers)
      .innerJoin(formFields, eq(answers.fieldId, formFields.id))
      .innerJoin(fieldOptions, eq(answers.answerOptionId, fieldOptions.id))
      .where(and(eq(formFields.formId, formId), eq(formFields.section, "demographic")));

    const demoBySubmission = new Map<number, { department: string; year: string; gender: string }>();
    for (const row of demoRows) {
      const slot = demoBySubmission.get(row.submissionId) ?? { department: "", year: "", gender: "" };
      const label = (row.label ?? "").toLowerCase();
      const value = row.option ?? "";
      if (/gender|sex/.test(label)) slot.gender = value;
      else if (/year|level/.test(label)) slot.year = value;
      else if (/program|department|major|faculty|course/.test(label)) slot.department = value;
      demoBySubmission.set(row.submissionId, slot);
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

      const feedbackSegment: ThemeFeedbackPoint[] = rows.slice(0, FEEDBACK_SAMPLE).map((row) => {
        const demo = demoBySubmission.get(row.submissionId);
        return {
          id: String(row.id),
          sentiment: row.sentiment as Sentiment,
          quote: row.pointText ?? "",
          originalFeedback: row.originalFeedback ?? row.pointText ?? "",
          submittedAt: row.submittedAt ?? new Date().toISOString(),
          department: demo?.department || "Unspecified",
          year: demo?.year || "Unspecified",
          gender: demo?.gender || "Unspecified",
        };
      });

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
};
