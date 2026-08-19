import { Elysia } from "elysia";

import { topicController } from "../controllers/topicController";
import { requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";
import { createTopicSchema } from "../validators/topicValidator";

const tags = ["Topics"];
const security = [{ bearerAuth: [] }];

export const topicRoutes = new Elysia({ prefix: "/topics" })
  .use(requireAuth)
  .get(
    "/",
    async () => {
      const data = await topicController.list();
      return successResponse("Topics loaded successfully", data);
    },
    { detail: { tags, security, summary: "List canonical topics" } },
  )
  .get(
    "/:id",
    async ({ params }) => {
      const id = parseIntParam(params.id, "topic id");
      const data = await topicController.get(id);
      return successResponse("Topic loaded successfully", data);
    },
    { detail: { tags, security, summary: "Get a topic with its trend history and sample points" } },
  )
  .post(
    "/",
    async ({ body, set }) => {
      const data = await topicController.create(body);
      set.status = 201;
      return successResponse("Topic created successfully", data);
    },
    {
      body: createTopicSchema,
      detail: {
        tags,
        security,
        summary: "Manually create a topic",
        description: "Topics are normally produced by the AI pipeline; this exists for manual/testing use.",
      },
    },
  );
