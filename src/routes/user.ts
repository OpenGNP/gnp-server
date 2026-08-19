import { Elysia } from "elysia";

import { userController } from "../controllers/userController";
import { assertCurrentUser, requireAuth } from "../middleware/authMiddleware";
import { successResponse } from "../utils/response";

const tags = ["Users"];
const security = [{ bearerAuth: [] }];

export const userRoutes = new Elysia({ prefix: "/users" })
  .use(requireAuth)
  .get(
    "/me",
    async ({ currentUser }) => {
      assertCurrentUser(currentUser);
      const user = await userController.me(currentUser);
      return successResponse("Current user loaded successfully", user);
    },
    { detail: { tags, security, summary: "Get the authenticated user" } },
  )
  .get(
    "/",
    async ({ currentUser, query }) => {
      assertCurrentUser(currentUser);
      const search = typeof query.search === "string" ? query.search : undefined;
      const data = await userController.list(currentUser, search);
      return successResponse("Users loaded successfully", data);
    },
    { detail: { tags, security, summary: "List members of my organization" } },
  );
