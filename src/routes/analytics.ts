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
    "/forms/:id/individual",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.individualResponses(id, currentUser.id);
      return successResponse("Individual responses loaded successfully", data);
    },
    { detail: { tags, security, summary: "Every submission with its answers, newest first (Individual tab)" } },
  )
  .get(
    "/forms/:id/themes",
    async ({ params, query, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.formThemes(id, currentUser.id, {
        from: typeof query.from === "string" ? query.from : undefined,
        to: typeof query.to === "string" ? query.to : undefined,
        demo: typeof query.demo === "string" ? query.demo : undefined,
        tz: typeof query.tz === "string" ? query.tz : undefined,
      });
      return successResponse("Form theme analytics loaded successfully", data);
    },
    {
      detail: {
        tags,
        security,
        summary: "Topic / sentiment analysis for one form (Themes tab)",
        description: "Query: from / to (ISO dates) — defaults to the span of the form's analysed feedback. " +
          "demo (JSON object {question label: [answers]}) narrows to respondents matching every selected question. " +
          "tz (IANA zone, e.g. Asia/Bangkok) sets where days start for buckets and labels; default UTC.",
      },
    },
  )
  .get(
    "/forms/:id/themes/export",
    async ({ params, query, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const { buffer, contentType } = await analyticsController.exportThemes(id, currentUser.id, {
        from: typeof query.from === "string" ? query.from : undefined,
        to: typeof query.to === "string" ? query.to : undefined,
        demo: typeof query.demo === "string" ? query.demo : undefined,
        tz: typeof query.tz === "string" ? query.tz : undefined,
        includeNames: query.names !== "0",
      });
      return new Response(buffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": 'attachment; filename="themes.xlsx"',
          "Cache-Control": "no-store",
        },
      });
    },
    {
      detail: {
        tags,
        security,
        summary: "Download the Themes tab (AI analysis) as xlsx",
        description: "Same from / to / demo / tz as GET /forms/:id/themes. `names=0` leaves respondent names out.",
      },
    },
  )
  .get(
    "/forms/:id/trend",
    async ({ params, query, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await analyticsController.formTrend(id, currentUser.id, {
        from: typeof query.from === "string" ? query.from : undefined,
        to: typeof query.to === "string" ? query.to : undefined,
        bucket: typeof query.bucket === "string" ? query.bucket : undefined,
        rank: typeof query.rank === "string" ? query.rank : undefined,
        topics: typeof query.topics === "string" ? query.topics : undefined,
        tz: typeof query.tz === "string" ? query.tz : undefined,
        demo: typeof query.demo === "string" ? query.demo : undefined,
      });
      return successResponse("Form trend analytics loaded successfully", data);
    },
    {
      detail: {
        tags,
        security,
        summary: "Trend over a time window + bucket (Trend tab)",
        description:
          "Query: from / to (ISO dates), bucket (day | week | month | year), " +
          "rank (mentioned | violation — orders availableTopics + auto-picks lines), " +
          "topics (comma-separated topic ids to chart, max 8), tz (IANA zone — where days start; default UTC), " +
          "demo (same JSON demographic filter as /themes). " +
          "Returns a real time series plus availableTopics for the picker.",
      },
    },
  );
