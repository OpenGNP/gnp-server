import { Elysia } from "elysia";

import { authController } from "../controllers/authController";
import { authJwt, toAuthPayload } from "../plugins/jwt";
import { AUTH_COOKIE_NAME, authCookieOptions } from "../utils/cookies";
import { successResponse } from "../utils/response";
import { loginSchema } from "../validators/authValidator";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authJwt)
  .post(
    "/login",
    async ({ body, jwt, cookie }) => {
      const user = await authController.login(body);
      const token = await jwt.sign(toAuthPayload(user));
      cookie[AUTH_COOKIE_NAME]!.set({ value: token, ...authCookieOptions });

      return successResponse("Logged in successfully", { user, token });
    },
    {
      body: loginSchema,
      detail: { tags: ["Auth"], summary: "Log in with email and password" },
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
