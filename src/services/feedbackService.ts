import { and, eq, or } from "drizzle-orm";

import { answers, db, submissions } from "../db/client";
import type { CurrentUser } from "../middleware/authMiddleware";
import { badRequest, conflict, notFound } from "../utils/errors";
import { anonymousIdentityCode, createId } from "../utils/helper";
import type { SubmitFeedbackInput } from "../validators/feedbackValidator";
import { formService } from "./formService";

export const feedbackService = {
  async create(input: SubmitFeedbackInput, viewer: CurrentUser | null) {
    const form = await formService.getFormForSubmission(input.formId, viewer);
    const fieldsById = new Map(form.formFields.map((field) => [field.id, field]));

    for (const answer of input.answers) {
      const field = fieldsById.get(answer.fieldId);
      if (!field) throw badRequest(`Field ${answer.fieldId} does not belong to this form`);

      if (answer.answerOptionId !== undefined) {
        const validOption = field.fieldOptions.some((option) => option.id === answer.answerOptionId);
        if (!validOption) throw badRequest(`Invalid option selected for field ${answer.fieldId}`);
      }
    }

    const answeredFieldIds = new Set(input.answers.map((answer) => answer.fieldId));
    const missingRequired = form.formFields.filter((field) => field.isRequired && !answeredFieldIds.has(field.id));

    if (missingRequired.length > 0) {
      throw badRequest(`Missing required field(s): ${missingRequired.map((field) => field.fieldLabel).join(", ")}`);
    }

    // `userId` is only stored when the form owner opted into recording who
    // responded (`recordName`) — otherwise the submission must not be linkable to
    // a real account. But `oneResponsePerPerson` still needs *some* way to
    // recognise a repeat visitor even when recordName is off (or there's no
    // account at all — a fully public form): `anonymousIdentityCode` is a
    // deterministic HMAC of (formId, identity) — the same person always produces
    // the same code, but it can't be reversed back to their identity, and can't
    // be correlated across other forms. `identity` is the signed-in viewer's id
    // when there is one, else the respondent's client-generated `deviceId` (a
    // random token their browser persists) — same soft, best-effort dedup either
    // way; a device id doesn't survive cleared storage/incognito/another device.
    const pseudonymousCode = viewer
      ? anonymousIdentityCode(form.id, String(viewer.id))
      : input.deviceId
        ? anonymousIdentityCode(form.id, input.deviceId)
        : null;

    if (form.oneResponsePerPerson && pseudonymousCode) {
      const existing = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(
          and(
            eq(submissions.formId, form.id),
            viewer
              ? or(eq(submissions.userId, viewer.id), eq(submissions.anonymousCode, pseudonymousCode))
              : eq(submissions.anonymousCode, pseudonymousCode),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        throw conflict("You have already submitted a response to this form");
      }
    }

    const recordUser = Boolean(form.recordName && viewer);

    return db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(submissions)
        .values({
          formId: form.id,
          userId: recordUser ? viewer!.id : null,
          // A truly anonymous guest (no viewer at all) gets a random code — there's
          // no identity to hash, and nothing to dedup against anyway.
          anonymousCode: recordUser ? null : (pseudonymousCode ?? createId("resp")),
          submissionStatus: "completed",
        })
        .returning();

      const insertedAnswers = await tx
        .insert(answers)
        .values(
          input.answers.map((answer) => ({
            submissionId: submission!.id,
            fieldId: answer.fieldId,
            answerText: answer.answerText,
            answerOptionId: answer.answerOptionId,
          })),
        )
        .returning();

      return { ...submission!, answers: insertedAnswers };
    });
  },

  async listByForm(formId: number, adminId: number) {
    await formService.assertOwnership(formId, adminId);

    return db.query.submissions.findMany({
      where: eq(submissions.formId, formId),
      orderBy: (row, { desc }) => [desc(row.createdAt)],
      with: { answers: true },
    });
  },

  async getById(submissionId: number, adminId: number) {
    const submission = await db.query.submissions.findFirst({
      where: eq(submissions.id, submissionId),
      with: {
        answers: true,
        form: { columns: { id: true, adminId: true, formTitle: true } },
      },
    });

    if (!submission || submission.form.adminId !== adminId) {
      throw notFound("Submission not found");
    }

    return submission;
  },
};
