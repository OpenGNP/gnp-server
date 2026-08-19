import { and, count, desc, eq } from "drizzle-orm";

import { answers, canonicalTopics, db, forms, points, submissions, topicTrends } from "../db/client";

const SENTIMENT_LABELS = ["positive", "neutral", "negative"] as const;

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
};
