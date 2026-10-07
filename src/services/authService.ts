import { eq, sql } from "drizzle-orm";

import { db, organizations, users } from "../db/client";
import { verifyMicrosoftIdToken } from "../lib/microsoftIdToken";
import { isUniqueViolation, unauthorized } from "../utils/errors";
import { verifyPassword } from "../utils/password";
import type { LoginInput, MicrosoftLoginInput } from "../validators/authValidator";

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

const findUserByEmail = (email: string) =>
  db.query.users.findFirst({ where: sql`lower(${users.email}) = ${email}` });

/** Matches a new account to the organization whose `organization_domain` is its email domain. */
async function organizationIdForEmail(email: string): Promise<number | null> {
  const domain = email.split("@")[1];
  if (!domain) return null;

  const organization = await db.query.organizations.findFirst({
    where: sql`lower(${organizations.organizationDomain}) = ${domain}`,
  });
  return organization?.id ?? null;
}

export const authService = {
  async login(input: LoginInput): Promise<SafeUser> {
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });

    if (!user?.password || !(await verifyPassword(input.password, user.password))) {
      throw unauthorized("Invalid email or password");
    }

    return toSafeUser(user);
  },

  /**
   * Signs in with a Microsoft ID token. An existing account with the same email is
   * reused (so seeded/password users can switch to Microsoft); otherwise a new
   * password-less `user` account is created.
   */
  async loginWithMicrosoft(input: MicrosoftLoginInput): Promise<SafeUser> {
    const identity = await verifyMicrosoftIdToken(input.idToken);

    const existing = await findUserByEmail(identity.email);
    if (existing) {
      if (!existing.fullName && identity.fullName) {
        const [updated] = await db
          .update(users)
          .set({ fullName: identity.fullName })
          .where(eq(users.id, existing.id))
          .returning();
        return toSafeUser(updated ?? existing);
      }
      return toSafeUser(existing);
    }

    try {
      const [created] = await db
        .insert(users)
        .values({
          email: identity.email,
          fullName: identity.fullName,
          password: null,
          role: "user",
          organizationId: await organizationIdForEmail(identity.email),
        })
        .returning();
      return toSafeUser(created!);
    } catch (error) {
      // Two first-time sign-ins raced; the other one created the row.
      if (isUniqueViolation(error)) {
        const user = await findUserByEmail(identity.email);
        if (user) return toSafeUser(user);
      }
      throw error;
    }
  },
};
