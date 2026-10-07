import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "../config/env";
import { unauthorized } from "../utils/errors";

/** The fixed `tid` Microsoft stamps on every personal (MSA) account's token. */
const PERSONAL_ACCOUNT_TENANT_ID = "9188040d-6c67-4c5b-b112-36a304b66dad";

const isMultiTenant = (tenant: string) => tenant === "common" || tenant === "organizations";

// `createRemoteJWKSet` caches the signing keys and refetches on an unknown `kid`,
// so Microsoft's key rotation is handled without a restart. The multi-tenant
// aliases all publish the same key set under /common.
const jwks = createRemoteJWKSet(
  new URL(
    `https://login.microsoftonline.com/${
      isMultiTenant(env.MICROSOFT_TENANT_ID) ? "common" : env.MICROSOFT_TENANT_ID
    }/discovery/v2.0/keys`,
  ),
);

export type MicrosoftIdentity = {
  email: string;
  fullName: string | null;
  tenantId: string;
};

/**
 * Verifies a Microsoft identity platform v2.0 ID token (signature, audience,
 * expiry, issuer) and returns who it identifies. Throws 401 on anything invalid.
 *
 * The issuer is checked by hand rather than via jwtVerify's `issuer` option because
 * for "common"/"organizations" it embeds the signing-in user's own tenant id.
 */
export async function verifyMicrosoftIdToken(idToken: string): Promise<MicrosoftIdentity> {
  if (!env.MICROSOFT_CLIENT_ID) {
    throw unauthorized("Microsoft sign-in is not configured on the server");
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, jwks, { audience: env.MICROSOFT_CLIENT_ID }));
  } catch {
    throw unauthorized("Invalid Microsoft sign-in token");
  }

  const tenantId = typeof payload.tid === "string" ? payload.tid : "";
  const configuredTenant = env.MICROSOFT_TENANT_ID;

  if (!tenantId || payload.iss !== `https://login.microsoftonline.com/${tenantId}/v2.0`) {
    throw unauthorized("Invalid Microsoft sign-in token");
  }
  if (!isMultiTenant(configuredTenant) && tenantId !== configuredTenant) {
    throw unauthorized("This Microsoft account's organization is not allowed to sign in");
  }
  if (configuredTenant === "organizations" && tenantId === PERSONAL_ACCOUNT_TENANT_ID) {
    throw unauthorized("Personal Microsoft accounts are not allowed — use your work or school account");
  }

  // `email` is only present when the optional claim is configured; `preferred_username`
  // is the UPN, which for work/school accounts is the sign-in email.
  const rawEmail = typeof payload.email === "string" ? payload.email : payload.preferred_username;
  if (typeof rawEmail !== "string" || !rawEmail.includes("@")) {
    throw unauthorized("Your Microsoft account has no email address");
  }

  return {
    email: rawEmail.trim().toLowerCase(),
    fullName: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
    tenantId,
  };
}
