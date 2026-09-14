import { z } from "zod";

export const submitFeedbackSchema = z.object({
  formId: z.number().int().positive(),
  // Client-generated, persisted in the respondent's browser (not tied to any
  // account) — lets oneResponsePerPerson dedupe an anonymous, not-signed-in
  // respondent. Optional: older/no-storage clients just can't be deduped.
  deviceId: z.string().trim().min(8).max(200).optional(),
  answers: z
    .array(
      z.object({
        fieldId: z.number().int().positive(),
        answerText: z.string().trim().min(1).max(5000).optional(),
        answerOptionId: z.number().int().positive().optional(),
      }),
    )
    .min(1),
});

export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;
