import { count, desc, eq, sql } from "drizzle-orm";

import { answers, canonicalTopics, db, points } from "../db/client";
import { notFound } from "../utils/errors";

export const topicService = {
  async list() {
    return db.select().from(canonicalTopics).orderBy(desc(canonicalTopics.topicSize));
  },

  async getById(id: number) {
    const [topic] = await db.select().from(canonicalTopics).where(eq(canonicalTopics.id, id)).limit(1);

    if (!topic) throw notFound("Topic not found");

    // Weekly counts for this topic. The week comes from the answer, not the
    // point: points.created_at is when the AI pipeline wrote the row, and the
    // pipeline runs in batches, so every point from one run shares a single
    // timestamp and the chart collapses into one bar.
    const periodStart = sql<string>`date_trunc('week', ${answers.createdAt})`;
    const trends = await db
      .select({
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
      .where(eq(points.canonicalTopicId, id))
      .groupBy(periodStart)
      .orderBy(periodStart);

    const samplePoints = await db
      .select({
        id: points.id,
        pointText: points.pointText,
        sentimentLabel: points.sentimentLabel,
        isViolation: points.isViolation,
        // the date a reader cares about is when it was submitted
        createdAt: answers.createdAt,
      })
      .from(points)
      .innerJoin(answers, eq(points.answerId, answers.id))
      .where(eq(points.canonicalTopicId, id))
      .orderBy(desc(answers.createdAt))
      .limit(20);

    return { ...topic, trends, samplePoints };
  },
};
