import { Elysia } from "elysia";

import { userController } from "../controllers/userController";
import { assertCurrentUser, requireAuth, requireRole } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";
import { createUserSchema, updateUserRoleSchema } from "../validators/userValidator";

const tags = ["Users"];
const security = [{ bearerAuth: [] }];

const selfServiceUserRoutes = new Elysia()
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

const adminUserRoutes = new Elysia()
  .use(requireRole("admin", "superadmin"))
  .post(
    "/",
    async ({ body, set }) => {
      const data = await userController.create(body);
      set.status = 201;
      return successResponse("Account created successfully", data);
    },
    {
      body: createUserSchema,
      detail: { tags, security, summary: "Create a new account (admin/superadmin only)" },
    },
  )
  .patch(
    "/:id/role",
    async ({ params, body }) => {
      const id = parseIntParam(params.id, "user id");
      const data = await userController.updateRole(id, body);
      return successResponse("User role updated successfully", data);
    },
    {
      body: updateUserRoleSchema,
      detail: { tags, security, summary: "Change a user's role (admin/superadmin only)" },
    },
  );

export const userRoutes = new Elysia({ prefix: "/users" }).use(selfServiceUserRoutes).use(adminUserRoutes);
