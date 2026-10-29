import { and, count, eq, ilike, or } from "drizzle-orm";

import { db, forms, organizations, submissions, users } from "../db/client";
import { conflict, isUniqueViolation, notFound } from "../utils/errors";
import { removeObjectSafely } from "../lib/minio";
import { hashPassword } from "../utils/password";
import type { CreateUserInput } from "../validators/userValidator";
import { avatarUrlFor, isAvatarKey } from "./avatarService";
import { isManagedCoverKey } from "./formService";
import { createGettingStartedForm } from "./gettingStartedForm";

const publicColumns = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  organizationId: users.organizationId,
  createdAt: users.createdAt,
};

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

export const userService = {
  /** What deleting this account takes with it, for the confirm dialog. */
  async deletionSummary(id: number) {
    const [owned] = await db.select({ value: count() }).from(forms).where(eq(forms.adminId, id));
    const [answered] = await db
      .select({ value: count(submissions.id) })
      .from(submissions)
      .innerJoin(forms, eq(submissions.formId, forms.id))
      .where(eq(forms.adminId, id));
    return { forms: owned?.value ?? 0, responses: answered?.value ?? 0 };
  },

  /**
   * Deletes the account. The DB cascades its forms (with their responses) and folders;
   * responses it sent to others' forms stay, unlinked. MinIO files are removed here.
   */
  async deleteSelf(id: number) {
    const [user] = await db.select({ role: users.role, avatarKey: users.avatarKey }).from(users).where(eq(users.id, id));
    if (!user) throw notFound("User not found");
    if (user.role === "superadmin") {
      const [supers] = await db.select({ value: count() }).from(users).where(eq(users.role, "superadmin"));
      if ((supers?.value ?? 0) <= 1) throw conflict("You're the only superadmin. Make someone else superadmin first.");
    }

    const covers = await db.select({ key: forms.coverImageUrl }).from(forms).where(eq(forms.adminId, id));
    await db.delete(users).where(eq(users.id, id));

    await Promise.all([
      ...covers.map(({ key }) => (isManagedCoverKey(key) ? removeObjectSafely(key) : null)),
      isAvatarKey(user.avatarKey) ? removeObjectSafely(user.avatarKey) : null,
    ]);
  },

  async getById(id: number) {
    const [user] = await db
      .select({ ...publicColumns, avatarKey: users.avatarKey, organizationName: organizations.organizationName })
      .from(users)
      .leftJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.id, id))
      .limit(1);

    if (!user) {
      throw notFound("User not found");
    }

    const { avatarKey, ...rest } = user;
    return { ...rest, avatarUrl: avatarUrlFor(user.id, avatarKey) };
  },

  async create(input: CreateUserInput) {
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
          role: input.role,
          organizationId,
        })
        .returning(publicColumns);

      await createGettingStartedForm(user!);
      return user!;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict("An account with this email already exists");
      }
      throw error;
    }
  },

  async updateRole(id: number, role: string) {
    const [user] = await db.update(users).set({ role }).where(eq(users.id, id)).returning(publicColumns);

    if (!user) {
      throw notFound("User not found");
    }

    return user;
  },

  async listByOrganization(organizationId: number | null, search?: string) {
    if (organizationId === null) {
      return [];
    }

    const conditions = [eq(users.organizationId, organizationId)];

    if (search) {
      const term = `%${search}%`;
      const searchCondition = or(ilike(users.fullName, term), ilike(users.email, term));
      if (searchCondition) conditions.push(searchCondition);
    }

    return db
      .select(publicColumns)
      .from(users)
      .where(and(...conditions))
      .orderBy(users.fullName);
  },
};
