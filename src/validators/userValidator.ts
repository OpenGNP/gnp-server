import { z } from "zod";

export const userRoleEnum = z.enum(["user", "staff", "admin", "superadmin"]);

export const createUserSchema = z.object({
  fullName: z.string().trim().min(1).max(255),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(8).max(72),
  role: userRoleEnum.default("user"),
  organizationName: z.string().trim().min(0).max(255).optional(),
});

export const updateUserRoleSchema = z.object({
  role: userRoleEnum,
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>;
