import { z } from "zod";

export const submitFeedbackSchema = z.object({
  formId: z.number().int().positive(),
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
