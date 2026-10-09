import { eq, sql } from "drizzle-orm";

import { db, organizations, users } from "../db/client";
import { fetchTenantDisplayName } from "../lib/microsoftGraph";
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

const findOrganizationByDomain = (
  client: Pick<typeof db, "query">,
  domain: string,
) =>
  client.query.organizations.findFirst({
    where: sql`lower(${organizations.organizationDomain}) = ${domain}`,
  });

/**
 * Finds the organization whose `organization_domain` is the email's domain, creating
 * it on the first sign-in from that domain. The new organization is named after the
 * Microsoft tenant (`resolveName`, a Graph lookup — only called when creating),
 * falling back to the domain. A transaction-scoped advisory lock on the domain
 * serialises concurrent first sign-ins, since `organization_domain` has no unique
 * constraint.
 */
async function findOrCreateOrganizationForEmail(
  email: string,
  resolveName: () => Promise<string | null>,
): Promise<number | null> {
  const domain = email.split("@")[1];
  if (!domain) return null;

  const existing = await findOrganizationByDomain(db, domain);
  if (existing) return existing.id;

  // Resolved outside the transaction so a slow Graph call doesn't hold the lock.
  const organizationName = (await resolveName()) ?? domain;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org-domain:${domain}`}))`);

    const raced = await findOrganizationByDomain(tx, domain);
    if (raced) return raced.id;

    const [created] = await tx
      .insert(organizations)
      .values({ organizationName, organizationDomain: domain })
      .returning({ id: organizations.id });
    return created!.id;
  });
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
   * password-less `user` account is created. A work/school account joins the
   * organization for its email domain (created on first sign-in); a personal
   * account (outlook.com, …) gets no organization.
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
          organizationId: identity.isPersonalAccount
            ? null
            : await findOrCreateOrganizationForEmail(identity.email, async () =>
                input.accessToken
                  ? fetchTenantDisplayName(input.accessToken, identity.tenantId)
                  : null,
              ),
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
