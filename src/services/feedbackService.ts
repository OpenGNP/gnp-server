import { and, eq } from "drizzle-orm";

import { answers, db, submissions } from "../db/client";
import type { CurrentUser } from "../middleware/authMiddleware";
import { badRequest, conflict, notFound } from "../utils/errors";
import { createId } from "../utils/helper";
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

    if (form.oneResponsePerPerson && viewer) {
      const existing = await db
        .select({ id: submissions.id })
        .from(submissions)
        .where(and(eq(submissions.formId, form.id), eq(submissions.userId, viewer.id)))
        .limit(1);

      if (existing.length > 0) {
        throw conflict("You have already submitted a response to this form");
      }
    }

    // `userId` is the dedup anchor for oneResponsePerPerson — it must be set
    // whenever the viewer is known, independent of `recordName` (which doesn't
    // otherwise affect storage today; nothing yet reads it back to display a name).
    // Tying `userId` to `recordName` instead — the old behavior — silently broke
    // oneResponsePerPerson for every form with recordName off (the default): every
    // submission got `userId: null`, so the dedup check above could never match.
    const identified = Boolean(viewer);

    return db.transaction(async (tx) => {
      const [submission] = await tx
        .insert(submissions)
        .values({
          formId: form.id,
          userId: identified ? viewer!.id : null,
          anonymousCode: identified ? null : createId("resp"),
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
