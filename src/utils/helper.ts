import { createHmac } from "node:crypto";

import { env } from "../config/env";

export const createId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

/**
 * Deterministic, non-reversible pseudonymous id for one (form, identity) pair —
 * the same pair always produces the same code, so a repeat submission can still
 * be detected for `oneResponsePerPerson` without ever storing the real identity.
 * `identity` is either a signed-in viewer's user id (as a string) or a fully
 * anonymous respondent's client-generated device id — same treatment either way.
 * Scoped by `formId` so the code can't be used to correlate the same person's
 * responses across different forms; keyed by the server secret (HMAC, not a
 * plain hash) so a numeric `userId` can't be reversed by brute-forcing the small
 * range of real ids (a device id is already an unguessable random token, but
 * there's no harm running it through the same construction).
 */
export const anonymousIdentityCode = (formId: number, identity: string): string =>
  `resp_${createHmac("sha256", env.JWT_SECRET).update(`${formId}:${identity}`).digest("hex")}`;
