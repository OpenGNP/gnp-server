import { count, desc, eq, sql } from "drizzle-orm";

import { canonicalTopics, db, points } from "../db/client";
import { notFound } from "../utils/errors";
import type { CreateTopicInput } from "../validators/topicValidator";

export const topicService = {
  async list() {
    return db.select().from(canonicalTopics).orderBy(desc(canonicalTopics.topicSize));
  },

  async getById(id: number) {
    const [topic] = await db.select().from(canonicalTopics).where(eq(canonicalTopics.id, id)).limit(1);

    if (!topic) throw notFound("Topic not found");

    // Weekly counts computed from this topic's points.
    const periodStart = sql<string>`date_trunc('week', ${points.createdAt})`;
    const trends = await db
      .select({
        periodStart: sql<string>`${periodStart}`.as("period_start"),
        periodEnd: sql<string>`${periodStart} + interval '7 days'`.as("period_end"),
        feedbackCount: count(),
        positiveCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'positive')`.mapWith(Number),
        neutralCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'neutral')`.mapWith(Number),
        negativeCount: sql<number>`count(*) filter (where ${points.sentimentLabel} = 'negative')`.mapWith(Number),
        severeCount: sql<number>`count(*) filter (where ${points.isSevere})`.mapWith(Number),
      })
      .from(points)
      .where(eq(points.canonicalTopicId, id))
      .groupBy(periodStart)
      .orderBy(periodStart);

    const samplePoints = await db
      .select({
        id: points.id,
        pointText: points.pointText,
        sentimentLabel: points.sentimentLabel,
        isSevere: points.isSevere,
        createdAt: points.createdAt,
      })
      .from(points)
      .where(eq(points.canonicalTopicId, id))
      .orderBy(desc(points.createdAt))
      .limit(20);

    return { ...topic, trends, samplePoints };
  },

  async create(input: CreateTopicInput) {
    const now = new Date().toISOString();

    const [topic] = await db
      .insert(canonicalTopics)
      .values({
        canonicalName: input.canonicalName,
        canonicalSummary: input.canonicalSummary,
        representativeKeywords: input.representativeKeywords,
        topicSize: 0,
        status: "active",
        firstDetectedAt: now,
        lastUpdatedAt: now,
      })
      .returning();

    return topic!;
  },
};
