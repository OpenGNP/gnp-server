import { Elysia } from "elysia";

import { authJwt, type AuthTokenPayload } from "../plugins/jwt";
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

async function resolveCurrentUser(
  jwt: { verify: (token: string) => Promise<Record<string, unknown> | false> },
  headers: Record<string, string | undefined>,
): Promise<CurrentUser | null> {
  const header = headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return null;

  const payload = await jwt.verify(token);
  return parsePayload(payload);
}

/** Derives `currentUser` (nullable) from a Bearer token. Never rejects the request. */
export const optionalAuth = new Elysia({ name: "optional-auth" })
  .use(authJwt)
  .derive({ as: "scoped" }, async ({ jwt, headers }) => ({
    currentUser: await resolveCurrentUser(jwt, headers),
  }));

/**
 * Guards a route group: rejects with 401 when there is no authenticated user.
 *
 * Deliberately self-contained (does not internally `.use(optionalAuth)`) — chaining
 * two separately-scoped `derive` plugins loses the inner value once a third instance
 * consumes the outer one, which is exactly the shape every route file needs here.
 */
export const requireAuth = new Elysia({ name: "require-auth" })
  .use(authJwt)
  .derive({ as: "scoped" }, async ({ jwt, headers }) => ({
    currentUser: await resolveCurrentUser(jwt, headers),
  }))
  .onBeforeHandle({ as: "scoped" }, ({ currentUser, status }) => {
    if (!currentUser) {
      return status(401, errorResponse("Unauthorized"));
    }
  });

/**
 * Narrows `currentUser` after a `requireAuth`-guarded handler starts running.
 * The guard already rejects unauthenticated requests before the handler runs;
 * this just gives TypeScript (and a defense-in-depth runtime check) the same fact.
 */
export function assertCurrentUser(user: CurrentUser | null): asserts user is CurrentUser {
  if (!user) throw unauthorized();
}
