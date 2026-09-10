import { Elysia } from "elysia";

import { analyticsController } from "../controllers/analyticsController";
import { assertCurrentUser, requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
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
  )
  .get(
    "/forms/:id/responses",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.formResponses(id, currentUser.id);
      return successResponse("Form response analytics loaded successfully", data);
    },
    { detail: { tags, security, summary: "Per-field answer breakdown for one form (Response tab)" } },
  )
  .get(
    "/forms/:id/themes",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.formThemes(id, currentUser.id);
      return successResponse("Form theme analytics loaded successfully", data);
    },
    { detail: { tags, security, summary: "Topic / sentiment analysis for one form (Themes tab)" } },
  )
  .get(
    "/forms/:id/trend",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.formTrend(id, currentUser.id);
      return successResponse("Form trend analytics loaded successfully", data);
    },
    { detail: { tags, security, summary: "Topic movement / emerging issues over time (Trend tab)" } },
  );
