import { desc, eq } from "drizzle-orm";

import { canonicalTopics, db, points, topicTrends } from "../db/client";
import { notFound } from "../utils/errors";
import type { CreateTopicInput } from "../validators/topicValidator";

export const topicService = {
  async list() {
    return db.select().from(canonicalTopics).orderBy(desc(canonicalTopics.topicSize));
  },

  async getById(id: number) {
    const [topic] = await db.select().from(canonicalTopics).where(eq(canonicalTopics.id, id)).limit(1);

    if (!topic) throw notFound("Topic not found");

    const trends = await db
      .select()
      .from(topicTrends)
      .where(eq(topicTrends.canonicalTopicId, id))
      .orderBy(topicTrends.periodStart);

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
