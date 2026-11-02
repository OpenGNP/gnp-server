import { eq, sql } from "drizzle-orm";

import { answers, db, points, submissions } from "../db/client";
import { badRequest, notFound } from "../utils/errors";
import { requireFormAccess } from "./formAccess";

/** Flagged by the AI and not dismissed by a reviewer: what every badge and count uses. */
export const activeViolationSql = sql<boolean>`(${points.isViolation} is true and ${points.violationStatus} is distinct from 'dismissed')`;

export type ViolationReview = "confirmed" | "dismissed" | null;

/**
 * Records a reviewer's call on a flagged point (form owner only). The AI pipeline never
 * overwrites a confirmed / dismissed status. `null` undoes the review: the original AI
 * level isn't kept, so it goes back to "possible" (needs a look).
 */
export async function reviewPointViolation(pointId: number, userId: number, review: ViolationReview) {
  const [point] = await db
    .select({ formId: submissions.formId, isViolation: points.isViolation })
    .from(points)
    .innerJoin(answers, eq(points.answerId, answers.id))
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(eq(points.id, pointId))
    .limit(1);
  if (!point) throw notFound("Feedback point not found");
  await requireFormAccess(point.formId, userId, "edit");
  if (!point.isViolation) throw badRequest("Only points flagged as a possible violation can be reviewed");

  await db
    .update(points)
    .set(
      review === null
        ? { violationStatus: "possible", violationReviewedBy: null, violationReviewedAt: null }
        : { violationStatus: review, violationReviewedBy: userId, violationReviewedAt: new Date().toISOString() },
    )
    .where(eq(points.id, pointId));
}
