import { z } from "zod";

export const createTopicSchema = z.object({
  canonicalName: z.string().trim().min(1).max(255),
  canonicalSummary: z.string().trim().max(2000).optional(),
  representativeKeywords: z.string().trim().max(1000).optional(),
});

export type CreateTopicInput = z.infer<typeof createTopicSchema>;
