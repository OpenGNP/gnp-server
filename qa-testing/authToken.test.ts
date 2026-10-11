import { describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { SignJWT } from "jose";

import { env } from "../src/config/env";
import { requireAuth } from "../src/middleware/authMiddleware";
import {
  authJwt,
  issueAuthToken,
  RENEWED_TOKEN_HEADER,
  TOKEN_IDLE_SECONDS,
  TOKEN_MAX_LIFETIME_SECONDS,
} from "../src/plugins/jwt";

const claims = { sub: "1", email: "admin@example.com", role: "admin", organizationId: 1 };
const now = () => Math.floor(Date.now() / 1000);

const { jwt } = new Elysia().use(authJwt).decorator as unknown as {
  jwt: Parameters<typeof issueAuthToken>[0] & {
    verify: (t: string) => Promise<Record<string, unknown> | false>;
  };
};

// The jwt plugin always stamps iat = now, so tokens "issued an hour ago" are signed
// directly with jose (same secret + algorithm) to fake their age.
const signAt = (payload: Record<string, unknown> & { iat: number; exp: number }) =>
  new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(env.JWT_SECRET));

const app = new Elysia().use(requireAuth).get("/me", ({ currentUser }) => currentUser);

const call = (token: string) =>
  app.handle(new Request("http://localhost/me", { headers: { authorization: `Bearer ${token}` } }));

describe("auth token expiry & renewal", () => {
  it("a fresh login lasts the idle window", async () => {
    const { token, maxAgeSeconds } = await issueAuthToken(jwt, claims);
    const payload = (await jwt.verify(token)) as { exp: number; iat: number; authTime: number };
    expect(maxAgeSeconds).toBe(TOKEN_IDLE_SECONDS);
    expect(payload.exp - payload.iat).toBe(TOKEN_IDLE_SECONDS);
    expect(payload.authTime).toBe(payload.iat);
  });

  it("a just-issued token is not renewed on every request", async () => {
    const { token } = await issueAuthToken(jwt, claims);
    const res = await call(token);
    expect(res.status).toBe(200);
    expect(res.headers.get(RENEWED_TOKEN_HEADER)).toBeNull();
  });

  it("an hour-old token comes back renewed (header + cookie), keeping authTime", async () => {
    const authTime = now() - 3600;
    const old = await signAt({ ...claims, authTime, iat: authTime, exp: authTime + TOKEN_IDLE_SECONDS });
    const res = await call(old);
    expect(res.status).toBe(200);
    const renewed = res.headers.get(RENEWED_TOKEN_HEADER);
    expect(renewed).toBeTruthy();
    expect(res.headers.get("set-cookie")).toContain("auth_token=");
    const payload = (await jwt.verify(renewed!)) as { exp: number; iat: number; authTime: number };
    expect(payload.authTime).toBe(authTime);
    expect(payload.exp).toBeGreaterThan(authTime + TOKEN_IDLE_SECONDS);
  });

  it("renewal never pushes past the absolute cap", async () => {
    const authTime = now() - TOKEN_MAX_LIFETIME_SECONDS + 600; // 10 minutes left of the cap
    const old = await signAt({ ...claims, authTime, iat: now() - 3600, exp: authTime + TOKEN_MAX_LIFETIME_SECONDS });
    const res = await call(old);
    expect(res.status).toBe(200);
    expect(res.headers.get(RENEWED_TOKEN_HEADER)).toBeNull(); // nothing left to extend
  });

  it("an expired token is rejected", async () => {
    const authTime = now() - TOKEN_IDLE_SECONDS - 100;
    const expired = await signAt({ ...claims, authTime, iat: authTime, exp: now() - 100 });
    expect((await call(expired)).status).toBe(401);
  });
});
