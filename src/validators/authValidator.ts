import { z } from "zod";

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export const microsoftLoginSchema = z.object({
  idToken: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type MicrosoftLoginInput = z.infer<typeof microsoftLoginSchema>;
