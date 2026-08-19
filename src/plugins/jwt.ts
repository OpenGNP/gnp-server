import { jwt } from "@elysiajs/jwt";

import { env } from "../config/env";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  role: string;
  organizationId: number | null;
};

export const authJwt = jwt({
  name: "jwt",
  secret: env.JWT_SECRET,
  exp: "7d",
});

export const toAuthPayload = (user: {
  id: number;
  email: string;
  role: string | null;
  organizationId: number | null;
}): AuthTokenPayload => ({
  sub: String(user.id),
  email: user.email,
  role: user.role ?? "admin",
  organizationId: user.organizationId,
});
