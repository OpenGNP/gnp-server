import { env } from "../config/env";

export const AUTH_COOKIE_NAME = "auth_token";

/** Seconds; kept in sync with the JWT's `exp` in src/plugins/jwt.ts. */
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

/**
 * `secure` is only enabled in production because dev runs over plain http://localhost,
 * where browsers drop `Secure` cookies entirely. `sameSite: "lax"` covers same-site
 * deployments (including the localhost:5173 -> localhost:3000 dev split, which counts
 * as same-site); a cross-site production split needs `sameSite: "none"` + secure: true.
 */
export const authCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: AUTH_COOKIE_MAX_AGE,
};
