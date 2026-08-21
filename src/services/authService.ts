import { eq } from "drizzle-orm";

import { db, users } from "../db/client";
import { unauthorized } from "../utils/errors";
import { verifyPassword } from "../utils/password";
import type { LoginInput } from "../validators/authValidator";

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

export const authService = {
  async login(input: LoginInput): Promise<SafeUser> {
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });

    if (!user?.password || !(await verifyPassword(input.password, user.password))) {
      throw unauthorized("Invalid email or password");
    }

    return toSafeUser(user);
  },
};
