import { Elysia } from "elysia";

import { topicController } from "../controllers/topicController";
import { requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";

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
  );
