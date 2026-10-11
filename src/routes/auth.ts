import { Elysia } from "elysia";

import { authController } from "../controllers/authController";
import { authJwt, issueAuthToken, toAuthPayload } from "../plugins/jwt";
import { AUTH_COOKIE_NAME, authTokenCookie } from "../utils/cookies";
import { successResponse } from "../utils/response";
import { loginSchema, microsoftLoginSchema } from "../validators/authValidator";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authJwt)
  .post(
    "/login",
    async ({ body, jwt, cookie }) => {
      const user = await authController.login(body);
      const { token, maxAgeSeconds } = await issueAuthToken(jwt, toAuthPayload(user));
      cookie[AUTH_COOKIE_NAME]!.set(authTokenCookie(token, maxAgeSeconds));

      return successResponse("Logged in successfully", { user, token });
    },
    {
      body: loginSchema,
      detail: { tags: ["Auth"], summary: "Log in with email and password" },
    },
  )
  .post(
    "/microsoft",
    async ({ body, jwt, cookie }) => {
      const user = await authController.loginWithMicrosoft(body);
      const { token, maxAgeSeconds } = await issueAuthToken(jwt, toAuthPayload(user));
      cookie[AUTH_COOKIE_NAME]!.set(authTokenCookie(token, maxAgeSeconds));

      return successResponse("Logged in successfully", { user, token });
    },
    {
      body: microsoftLoginSchema,
      detail: {
        tags: ["Auth"],
        summary: "Log in with a Microsoft (Entra ID) ID token obtained via MSAL",
      },
    },
  )
  .post(
    "/logout",
    ({ cookie }) => {
      cookie[AUTH_COOKIE_NAME]!.remove();
      return successResponse("Logged out successfully", null);
    },
    { detail: { tags: ["Auth"], summary: "Clear the auth cookie" } },
  );
