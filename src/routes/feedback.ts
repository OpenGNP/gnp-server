import { Elysia } from "elysia";

import { feedbackController } from "../controllers/feedbackController";
import { assertCurrentUser, optionalAuth, requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";
import { submitFeedbackSchema } from "../validators/feedbackValidator";

const tags = ["Feedback"];
const security = [{ bearerAuth: [] }];

const publicFeedbackRoutes = new Elysia().use(optionalAuth).post(
  "/",
  async ({ body, currentUser, set }) => {
    const data = await feedbackController.create(body, currentUser);
    set.status = 201;
    return successResponse("Feedback submitted successfully", data);
  },
  {
    body: submitFeedbackSchema,
    detail: {
      tags,
      summary: "Submit a form response",
      description:
        "An optional Bearer token is used for organization/specific-people access checks, " +
        "one-response-per-person enforcement, and (if the form records names) attributing the response to a user.",
    },
  },
);

const adminFeedbackRoutes = new Elysia()
  .use(requireAuth)
  .get(
    "/form/:formId",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.formId, "form id");
      const data = await feedbackController.listByForm(formId, currentUser.id);
      return successResponse("Feedback loaded successfully", data);
    },
    { detail: { tags, security, summary: "List submissions for a form" } },
  )
  .get(
    "/:id",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "submission id");
      const data = await feedbackController.getById(id, currentUser.id);
      return successResponse("Feedback loaded successfully", data);
    },
    { detail: { tags, security, summary: "Get a single submission with its answers" } },
  );

export const feedbackRoutes = new Elysia({ prefix: "/feedback" })
  .use(publicFeedbackRoutes)
  .use(adminFeedbackRoutes);
