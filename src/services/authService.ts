import { eq, sql } from "drizzle-orm";

import { db, organizations, users } from "../db/client";
import { fetchTenantDisplayName } from "../lib/microsoftGraph";
import { verifyMicrosoftIdToken } from "../lib/microsoftIdToken";
import { avatarUrlFor, syncMicrosoftAvatar } from "./avatarService";
import { createGettingStartedForm } from "./gettingStartedForm";
import { clearLoginFailures, lockedForMinutes, recordLoginFailure } from "../lib/loginAttempts";
import { isUniqueViolation, tooManyRequests, unauthorized } from "../utils/errors";
import { verifyPassword } from "../utils/password";
import type { LoginInput, MicrosoftLoginInput } from "../validators/authValidator";

export type SafeUser = {
  id: number;
  fullName: string | null;
  email: string;
  role: string | null;
  organizationId: number | null;
  /** The Microsoft profile photo, if any (else the client shows initials). */
  avatarUrl: string | null;
};

const toSafeUser = (user: typeof users.$inferSelect): SafeUser => ({
  id: user.id,
  fullName: user.fullName,
  email: user.email,
  role: user.role,
  organizationId: user.organizationId,
  avatarUrl: avatarUrlFor(user.id, user.avatarKey),
});

// Sign-in waits this long for the photo; past it, the sync finishes on its own.
const AVATAR_WAIT_MS = 3000;

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

/**
 * The account for a verified Microsoft identity: an existing one with the same email is
 * reused (so seeded/password users can switch to Microsoft); otherwise a new
 * password-less `user` account is created, with its getting-started form.
 */
async function findOrCreateMicrosoftUser(
  input: MicrosoftLoginInput,
  identity: Awaited<ReturnType<typeof verifyMicrosoftIdToken>>,
): Promise<typeof users.$inferSelect> {
  const existing = await findUserByEmail(identity.email);
  if (existing) {
    if (!existing.fullName && identity.fullName) {
      const [updated] = await db
        .update(users)
        .set({ fullName: identity.fullName })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
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
    await createGettingStartedForm(created!);
    return created!;
  } catch (error) {
    // Two first-time sign-ins raced; the other one created the row.
    if (isUniqueViolation(error)) {
      const user = await findUserByEmail(identity.email);
      if (user) return user;
    }
    throw error;
  }
}

const PASSWORD_LOGIN_ROLES = new Set(["admin", "superadmin"]);

export const authService = {
  /**
   * Email + password: admins only (seeded / team accounts) — everyone else signs in with
   * Microsoft. A non-admin gets the same "invalid" answer as a wrong password, so the
   * route doesn't reveal which emails exist or what role they have.
   */
  async login(input: LoginInput): Promise<SafeUser> {
    const minutes = lockedForMinutes(input.email);
    if (minutes > 0) {
      throw tooManyRequests(`Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`);
    }

    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    const allowed =
      user?.password &&
      PASSWORD_LOGIN_ROLES.has(user.role ?? "") &&
      (await verifyPassword(input.password, user.password));

    if (!user || !allowed) {
      recordLoginFailure(input.email);
      throw unauthorized("Invalid email or password");
    }

    clearLoginFailures(input.email);
    return toSafeUser(user);
  },

  /**
   * Signs in with a Microsoft ID token (account via findOrCreateMicrosoftUser). A
   * work/school account joins the organization for its email domain (created on first
   * sign-in); a personal account (outlook.com, …) gets no organization. With the access
   * token, also refreshes their profile photo.
   */
  async loginWithMicrosoft(input: MicrosoftLoginInput): Promise<SafeUser> {
    const identity = await verifyMicrosoftIdToken(input.idToken);
    const user = await findOrCreateMicrosoftUser(input, identity);
    if (!input.accessToken) return toSafeUser(user);

    // Their photo, refreshed every sign-in (it may have changed or been removed).
    const sync = syncMicrosoftAvatar(user.id, user.avatarKey, input.accessToken);
    const avatarKey = await Promise.race([
      sync,
      new Promise<string | null>((resolve) => setTimeout(() => resolve(user.avatarKey), AVATAR_WAIT_MS)),
    ]);
    return toSafeUser({ ...user, avatarKey });
  },
};
