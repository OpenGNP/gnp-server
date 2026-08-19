import { and, eq, ilike, or } from "drizzle-orm";

import { db, users } from "../db/client";
import { notFound } from "../utils/errors";

const publicColumns = {
  id: users.id,
  fullName: users.fullName,
  email: users.email,
  role: users.role,
  organizationId: users.organizationId,
  createdAt: users.createdAt,
};

export const userService = {
  async getById(id: number) {
    const [user] = await db.select(publicColumns).from(users).where(eq(users.id, id)).limit(1);

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
