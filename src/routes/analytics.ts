import { Elysia } from "elysia";

import { analyticsController } from "../controllers/analyticsController";
import { assertCurrentUser, requireAuth } from "../middleware/authMiddleware";
import { successResponse } from "../utils/response";

const tags = ["Analytics"];
const security = [{ bearerAuth: [] }];

export const analyticsRoutes = new Elysia({ prefix: "/analytics" })
  .use(requireAuth)
  .get(
    "/summary",
    async ({ currentUser }) => {
      assertCurrentUser(currentUser);
      const data = await analyticsController.summary(currentUser.id);
      return successResponse("Analytics summary loaded successfully", data);
    },
    { detail: { tags, security, summary: "Aggregate counts for my forms" } },
  )
  .get(
    "/trends",
    async ({ query }) => {
      const limit = typeof query.limit === "string" ? Number(query.limit) : undefined;
      const data = await analyticsController.trends(Number.isFinite(limit) ? limit : undefined);
      return successResponse("Topic trends loaded successfully", data);
    },
    { detail: { tags, security, summary: "Recent topic trend periods (platform-wide)" } },
  );
