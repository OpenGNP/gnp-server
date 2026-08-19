import { z } from "zod";

export const registerSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(72),
  organizationName: z.string().trim().min(1).max(255).optional(),
});

export const loginSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
