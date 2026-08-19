import { eq } from "drizzle-orm";

import { db, organizations, users } from "../db/client";
import { conflict, isUniqueViolation, unauthorized } from "../utils/errors";
import { hashPassword, verifyPassword } from "../utils/password";
import type { LoginInput, RegisterInput } from "../validators/authValidator";

export type SafeUser = {
  id: number;
  fullName: string | null;
  email: string;
  role: string | null;
  organizationId: number | null;
};

const toSafeUser = (user: typeof users.$inferSelect): SafeUser => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
});

async function resolveOrganizationId(organizationName?: string): Promise<number | null> {
  if (!organizationName) return null;

  const existing = await db.query.organizations.findFirst({
    where: eq(organizations.organizationName, organizationName),
  });

  if (existing) return existing.id;

  const [created] = await db
    .insert(organizations)
    .values({ organizationName })
    .returning({ id: organizations.id });

  return created!.id;
}

export const authService = {
  async register(input: RegisterInput): Promise<SafeUser> {
    const existing = await db.query.users.findFirst({ where: eq(users.email, input.email) });

    if (existing) {
      throw conflict("An account with this email already exists");
    }

    const organizationId = await resolveOrganizationId(input.organizationName);
    const passwordHash = await hashPassword(input.password);

    try {
      const [user] = await db
        .insert(users)
        .values({
          fullName: input.fullName,
          email: input.email,
          password: passwordHash,
          role: "admin",
          organizationId,
        })
        .returning();

      return toSafeUser(user!);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("An account with this email already exists");
      }
      throw error;
    }
  },

  async login(input: LoginInput): Promise<SafeUser> {
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });

    if (!user?.password || !(await verifyPassword(input.password, user.password))) {
      throw unauthorized("Invalid email or password");
    }

    return toSafeUser(user);
  },
};
