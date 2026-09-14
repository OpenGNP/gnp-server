import { createHmac } from "node:crypto";

import { env } from "../config/env";

export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

/**
 * Deterministic, non-reversible pseudonymous id for one (form, user) pair — the
 * same pair always produces the same code, so a repeat anonymous submission can
 * still be detected for `oneResponsePerPerson` without ever storing the real
 * `userId`. Scoped by `formId` so the code can't be used to correlate the same
 * person's responses across different forms; keyed by the server secret (HMAC,
 * not a plain hash) so it can't be reversed back to a `userId` by brute-forcing
 * the small range of real ids.
 */
export const anonymousIdentityCode = (formId: number, userId: number): string =>
  `resp_${createHmac("sha256", env.JWT_SECRET).update(`${formId}:${userId}`).digest("hex")}`;
