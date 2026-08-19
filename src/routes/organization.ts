import { Elysia } from "elysia";

import { organizationController } from "../controllers/organizationController";
import { successResponse } from "../utils/response";

export const organizationRoutes = new Elysia({ prefix: "/orgs" }).get(
  "/",
  async () => {
    const data = await organizationController.list();
    return successResponse("Organizations loaded successfully", data);
  },
  { detail: { tags: ["Organizations"], summary: "List organizations (for the registration form)" } },
);
