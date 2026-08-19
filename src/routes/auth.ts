import { Elysia } from "elysia";

import { authController } from "../controllers/authController";
import { authJwt, toAuthPayload } from "../plugins/jwt";
import { successResponse } from "../utils/response";
import { loginSchema, registerSchema } from "../validators/authValidator";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authJwt)
  .post(
    "/register",
    async ({ body, jwt, set }) => {
      const user = await authController.register(body);
      const token = await jwt.sign(toAuthPayload(user));

      set.status = 201;
      return successResponse("Registered successfully", { user, token });
    },
    {
      body: registerSchema,
      detail: { tags: ["Auth"], summary: "Register a new admin account" },
    },
  )
  .post(
    "/login",
    async ({ body, jwt }) => {
      const user = await authController.login(body);
      const token = await jwt.sign(toAuthPayload(user));

      return successResponse("Logged in successfully", { user, token });
    },
    {
      body: loginSchema,
      detail: { tags: ["Auth"], summary: "Log in with email and password" },
    },
  );
