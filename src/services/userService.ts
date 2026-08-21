import { and, eq, ilike, or } from "drizzle-orm";

import { db, organizations, users } from "../db/client";
import { conflict, isUniqueViolation, notFound } from "../utils/errors";
import { hashPassword } from "../utils/password";
import type { CreateUserInput } from "../validators/userValidator";

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
  async getById(id: number) {
    const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);

    if (!user) {
      throw notFound("User not found");
    }

    return user;
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
