import { Elysia } from "elysia";

import { authJwt, type AuthTokenPayload } from "../plugins/jwt";
import { AUTH_COOKIE_NAME } from "../utils/cookies";
import { unauthorized } from "../utils/errors";
import { errorResponse } from "../utils/response";

export type CurrentUser = {
  id: number;
  email: string;
  role: string;
  organizationId: number | null;
};

const parsePayload = (payload: Record<string, unknown> | false): CurrentUser | null => {
  if (!payload) return null;

  const { sub, email, role, organizationId } = payload as Partial<AuthTokenPayload>;
  const id = Number(sub);

  if (!sub || Number.isNaN(id) || typeof email !== "string" || typeof role !== "string") {
    return null;
  }

  return {
    id,
    email,
    role,
    organizationId: typeof organizationId === "number" ? organizationId : null,
  };
};

/**
 * Prefers an explicit `Authorization: Bearer` header (API clients, mobile apps, the
 * Scalar docs "Authorize" button) and falls back to the httpOnly auth cookie set by
 * /auth/login (browser clients).
 */
async function resolveCurrentUser(
  jwt: { verify: (token: string) => Promise<Record<string, unknown> | false> },
  headers: Record<string, string | undefined>,
  cookie: Record<string, { value?: unknown }>,
): Promise<CurrentUser | null> {
  const header = headers.authorization;
  const bearerToken = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const cookieValue = cookie[AUTH_COOKIE_NAME]?.value;
  const cookieToken = typeof cookieValue === "string" ? cookieValue : undefined;
  const token = bearerToken ?? cookieToken;

  if (!token) return null;

  const payload = await jwt.verify(token);
  return parsePayload(payload);
}

/** Derives `currentUser` (nullable) from a Bearer token or the auth cookie. Never rejects the request. */
export const optionalAuth = new Elysia({ name: "optional-auth" })
  .use(authJwt)
  .derive({ as: "scoped" }, async ({ jwt, headers, cookie }) => ({
    currentUser: await resolveCurrentUser(jwt, headers, cookie),
  }));

/**
 * Builds a self-contained auth guard plugin (its own `.use(authJwt)` + `derive` +
 * `onBeforeHandle`, all `scoped`) rather than composing guards via `.use()` — chaining
 * two separately-scoped `derive` plugins loses the inner value once a third instance
 * consumes the outer one, so every guard re-derives `currentUser` itself instead of
 * layering on top of another guard.
 */
function buildGuard(name: string, allowedRoles?: string[]) {
  return new Elysia({ name })
    .use(authJwt)
    .derive({ as: "scoped" }, async ({ jwt, headers, cookie }) => ({
      currentUser: await resolveCurrentUser(jwt, headers, cookie),
    }))
    .onBeforeHandle({ as: "scoped" }, ({ currentUser, status }) => {
      if (!currentUser) {
        return status(401, errorResponse("Unauthorized"));
      }
      if (allowedRoles && !allowedRoles.includes(currentUser.role)) {
        return status(403, errorResponse("Forbidden"));
      }
    });
}

/** Guards a route group: rejects with 401 when there is no authenticated user. */
export const requireAuth = buildGuard("require-auth");

/** Guards a route group: rejects with 401 when unauthenticated, 403 when the role isn't allowed. */
export const requireRole = (...roles: string[]) => buildGuard(`require-role-${roles.join("-")}`, roles);

/**
 * Narrows `currentUser` after a `requireAuth`-guarded handler starts running.
 * The guard already rejects unauthenticated requests before the handler runs;
 * this just gives TypeScript (and a defense-in-depth runtime check) the same fact.
 */
export function assertCurrentUser(user: CurrentUser | null): asserts user is CurrentUser {
  if (!user) throw unauthorized();
}
