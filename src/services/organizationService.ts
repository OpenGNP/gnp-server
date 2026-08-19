import { asc } from "drizzle-orm";

import { db, organizations } from "../db/client";

export const organizationService = {
  list() {
    return db
      .select({
        id: organizations.id,
        organizationName: organizations.organizationName,
        organizationDomain: organizations.organizationDomain,
      })
      .from(organizations)
      .orderBy(asc(organizations.organizationName));
  },
};
