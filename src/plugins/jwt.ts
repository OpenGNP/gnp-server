import { jwt } from "@elysiajs/jwt";

import { env } from "../config/env";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  role: string;
  organizationId: number | null;
  /** Unix seconds of the original sign-in — caps how long renewals can extend it (see below). */
  authTime: number;
};

// No default `exp`: every token's expiry is computed by issueAuthToken below.
export const authJwt = jwt({
  name: "jwt",
  secret: env.JWT_SECRET,
});

export const toAuthPayload = (user: {
  id: number;
  email: string;
  role: string | null;
  organizationId: number | null;
}): Omit<AuthTokenPayload, "authTime"> => ({
  sub: String(user.id),
  email: user.email,
  role: user.role ?? "admin",
  organizationId: user.organizationId,
});

// ---- Expiry & renewal -------------------------------------------------------
// Still plain stateless JWTs — nothing is stored server-side. The limits live in
// each token's own `exp`: a token is good for TOKEN_IDLE_SECONDS after the user's
// last activity (active users get a fresh token periodically), but never longer
// than TOKEN_MAX_LIFETIME_SECONDS after they actually signed in. Tweak these two
// to change the policy.
export const TOKEN_IDLE_SECONDS = 24 * 60 * 60; // 24 hours without using the app
export const TOKEN_MAX_LIFETIME_SECONDS = 14 * 24 * 60 * 60; // 14 days since sign-in, hard cap

/** Re-issue at most this often while active, so not every request mints a token. */
const RENEW_AFTER_SECONDS = 15 * 60;

/** Response header carrying a renewed token, for clients that send `Authorization: Bearer`. */
export const RENEWED_TOKEN_HEADER = "x-auth-token";

type TokenSigner = { sign: (payload: AuthTokenPayload & { exp: number; iat: true }) => Promise<string> };

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Signs an auth token: expires after the idle window, capped at the absolute limit. */
export async function issueAuthToken(
  jwt: TokenSigner,
  claims: Omit<AuthTokenPayload, "authTime">,
  authTime: number = nowSeconds(),
): Promise<{ token: string; maxAgeSeconds: number }> {
  const now = nowSeconds();
  const exp = Math.min(now + TOKEN_IDLE_SECONDS, authTime + TOKEN_MAX_LIFETIME_SECONDS);
  const token = await jwt.sign({ ...claims, authTime, exp, iat: true });
  return { token, maxAgeSeconds: Math.max(exp - now, 0) };
}

/**
 * Whether a still-valid token should be swapped for a fresh one on this request:
 * it's older than RENEW_AFTER_SECONDS and renewing would actually extend it (it
 * hasn't already hit the absolute cap).
 */
export function shouldRenewAuthToken(payload: Record<string, unknown>): boolean {
  const now = nowSeconds();
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const authTime = tokenAuthTime(payload);
  const renewedExp = Math.min(now + TOKEN_IDLE_SECONDS, authTime + TOKEN_MAX_LIFETIME_SECONDS);
  return now - iat >= RENEW_AFTER_SECONDS && renewedExp > exp + 60;
}

/** When the user originally signed in. Tokens issued before renewal existed lack it — fall back to `iat`. */
export function tokenAuthTime(payload: Record<string, unknown>): number {
  if (typeof payload.authTime === "number") return payload.authTime;
  if (typeof payload.iat === "number") return payload.iat;
  return nowSeconds();
}
