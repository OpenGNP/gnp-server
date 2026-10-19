import { Elysia } from "elysia";

import { formEventStream } from "../lib/formEvents";
import { assertCurrentUser, requireAuth } from "../middleware/authMiddleware";
import { requireFormAccess } from "../services/formAccess";
import { parseIntParam } from "../utils/params";

const tags = ["Forms"];
const security = [{ bearerAuth: [] }];

/**
 * One fixed path for the live stream (the form is a query param), so a reverse proxy
 * can single it out with an exact match instead of a pattern — see deploy/nginx.conf.
 */
export const eventRoutes = new Elysia({ prefix: "/events" }).use(requireAuth).get(
  "/",
  async ({ query, currentUser, request }) => {
    assertCurrentUser(currentUser);
    const id = parseIntParam(typeof query.formId === "string" ? query.formId : "", "form id");
    await requireFormAccess(id, currentUser.id, "view");
    return formEventStream(id, request.signal);
  },
  {
    detail: {
      tags,
      security,
      summary: "Live changes to a form (Server-Sent Events)",
      description:
        "`GET /api/events?formId=42`. Events: `response` (new submission), `analysis` (gnp-ai finished a " +
        "run), `form` (form edited / opened / closed). Data is empty — refetch what the event names. Auth " +
        "via the auth cookie, since EventSource can't send headers.",
    },
  },
);
