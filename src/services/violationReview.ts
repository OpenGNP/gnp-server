import { eq, sql } from "drizzle-orm";

import { answers, db, points, submissions } from "../db/client";
import { badRequest, notFound } from "../utils/errors";
import { requireFormAccess } from "./formAccess";

/**
 * What every badge and count uses: flagged by the AI and not dismissed by a reviewer,
 * or confirmed by one (even if a later AI run unflags it).
 */
export const activeViolationSql = sql<boolean>`((${points.isViolation} is true and ${points.violationReviewedStatus} is distinct from 'dismissed') or ${points.violationReviewedStatus} = 'confirmed')`;

export type ViolationReview = "confirmed" | "dismissed" | null;

/**
 * Records a reviewer's call on a flagged point (form owner only), in its own column so
 * the AI's level (violation_status) is never touched: `null` undoes it and that level shows again.
 */
export async function reviewPointViolation(pointId: number, userId: number, review: ViolationReview) {
  const [point] = await db
    .select({ formId: submissions.formId, isViolation: points.isViolation, reviewed: points.violationReviewedStatus })
    .from(points)
    .innerJoin(answers, eq(points.answerId, answers.id))
    .innerJoin(submissions, eq(answers.submissionId, submissions.id))
    .where(eq(points.id, pointId))
    .limit(1);
  if (!point) throw notFound("Feedback point not found");
  await requireFormAccess(point.formId, userId, "edit");
  if (!point.isViolation && point.reviewed === null) throw badRequest("Only points flagged as a possible violation can be reviewed");

  await db
    .update(points)
    .set(
      review === null
        ? { violationReviewedStatus: null, violationReviewedBy: null, violationReviewedAt: null }
        : { violationReviewedStatus: review, violationReviewedBy: userId, violationReviewedAt: new Date().toISOString() },
    )
    .where(eq(points.id, pointId));
}
