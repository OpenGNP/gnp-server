import { Elysia } from "elysia";

import { analyticsController } from "../controllers/analyticsController";
import { formController } from "../controllers/formController";
import { getDemoForm } from "../services/demoForm";
import { successResponse } from "../utils/response";

const tags = ["Demo"];
const str = (value: unknown) => (typeof value === "string" ? value : undefined);

const download = (buffer: ArrayBuffer | Uint8Array | Buffer, contentType: string, filename: string) =>
  new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });

/**
 * The public /demo's data, no sign-in: the same reads as /forms/:id and /analytics/forms/:id,
 * for the demo form only. Read-only: anything the demo "saves" stays in the visitor's browser.
 */
export const demoRoutes = new Elysia({ prefix: "/demo" })
  .get(
    "/form",
    async () => {
      const form = await getDemoForm();
      return successResponse("Demo form loaded", await formController.getForEdit(form.id, form.adminId));
    },
    { detail: { tags, summary: "The demo form, as its editor loads it" } },
  )
  .get(
    "/export",
    async ({ query }) => {
      const form = await getDemoForm();
      const format = query.format === "csv" ? "csv" : "xlsx";
      const { buffer, contentType } = await formController.exportResponses(form.id, form.adminId, format, {
        timeZone: str(query.tz),
        includeNames: query.names !== "0",
      });
      return download(buffer, contentType, `responses.${format}`);
    },
    { detail: { tags, summary: "The demo form's responses as xlsx / csv (same query as /forms/:id/export)" } },
  )
  .get(
    "/themes/export",
    async ({ query }) => {
      const form = await getDemoForm();
      const { buffer, contentType } = await analyticsController.exportThemes(form.id, form.adminId, {
        from: str(query.from),
        to: str(query.to),
        demo: str(query.demo),
        tz: str(query.tz),
        sort: str(query.sort),
        includeNames: query.names !== "0",
      });
      return download(buffer, contentType, "themes.xlsx");
    },
    { detail: { tags, summary: "The demo's Themes tab as xlsx (same query as /analytics/forms/:id/themes/export)" } },
  )
  .get(
    "/responses",
    async () => {
      const form = await getDemoForm();
      return successResponse("Demo response analytics loaded", await analyticsController.formResponses(form.id, form.adminId));
    },
    { detail: { tags, summary: "Response tab for the demo form" } },
  )
  .get(
    "/individual",
    async () => {
      const form = await getDemoForm();
      return successResponse("Demo responses loaded", await analyticsController.individualResponses(form.id, form.adminId));
    },
    { detail: { tags, summary: "Individual tab for the demo form" } },
  )
  .get(
    "/themes",
    async ({ query }) => {
      const form = await getDemoForm();
      const data = await analyticsController.formThemes(form.id, form.adminId, {
        from: str(query.from),
        to: str(query.to),
        demo: str(query.demo),
        tz: str(query.tz),
      });
      return successResponse("Demo theme analytics loaded", data);
    },
    { detail: { tags, summary: "Themes tab for the demo form (same query as /analytics/forms/:id/themes)" } },
  )
  .get(
    "/trend",
    async ({ query }) => {
      const form = await getDemoForm();
      const data = await analyticsController.formTrend(form.id, form.adminId, {
        from: str(query.from),
        to: str(query.to),
        bucket: str(query.bucket),
        rank: str(query.rank),
        topics: str(query.topics),
        tz: str(query.tz),
        demo: str(query.demo),
      });
      return successResponse("Demo trend analytics loaded", data);
    },
    { detail: { tags, summary: "Trend tab for the demo form (same query as /analytics/forms/:id/trend)" } },
  );
