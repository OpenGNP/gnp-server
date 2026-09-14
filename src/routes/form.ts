import { Elysia } from "elysia";

import { formController } from "../controllers/formController";
import { assertCurrentUser, optionalAuth, requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";
import {
  createFieldOptionSchema,
  createFormFieldSchema,
  createFormSchema,
  reorderFieldsSchema,
  reorderFormsSchema,
  updateFormFieldSchema,
  updateFormSchema,
  uploadCoverImageSchema,
} from "../validators/formValidator";

const tags = ["Forms"];
const security = [{ bearerAuth: [] }];

/** Raw binary response for a cover image — bypasses the {success,message,data} envelope on purpose. */
function coverImageResponse({ buffer, contentType }: { buffer: Buffer; contentType: string }) {
  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      // Private: access is gated per-viewer, so a shared/CDN cache must never serve
      // one viewer's fetch to another. Short TTL since a cover can be replaced.
      "Cache-Control": "private, max-age=300",
    },
  });
}

const publicFormRoutes = new Elysia()
  .use(optionalAuth)
  .get(
    "/public/:token",
    async ({ params, query, currentUser }) => {
      const deviceId = typeof query.deviceId === "string" ? query.deviceId : undefined;
      const data = await formController.getPublicByToken(params.token, currentUser, deviceId);
      return successResponse("Form loaded successfully", data);
    },
    {
      detail: {
        tags,
        summary: "Get the respondent-facing view of a form by its public token",
        description:
          "Looked up by the form's unguessable public token (not its id), so a shared link can't be " +
          "enumerated. Enforces status and accessType; an optional Bearer token checks " +
          "organization/specific-people access but isn't required for public forms. Query `deviceId` " +
          "(no Bearer token) lets `alreadyResponded` work for a fully anonymous respondent too.",
      },
    },
  )
  .get(
    "/slug/:slug",
    async ({ params, query, currentUser }) => {
      const deviceId = typeof query.deviceId === "string" ? query.deviceId : undefined;
      const data = await formController.getPublicBySlug(params.slug, currentUser, deviceId);
      return successResponse("Form loaded successfully", data);
    },
    {
      detail: {
        tags,
        summary: "Get the respondent-facing view of a form by its human-readable slug",
        description:
          "Used for shareable `/form/{slug}` links. Enforces status, accessType, and the form's " +
          "start/end date window, in addition to the same optional-Bearer access checks and " +
          "`deviceId` query param as the public-token endpoint.",
      },
    },
  )
  .get(
    "/public/:token/cover-image",
    async ({ params, currentUser }) => {
      const image = await formController.getCoverImageByToken(params.token, currentUser);
      return coverImageResponse(image);
    },
    {
      detail: {
        tags,
        summary: "Get a form's cover image by public token",
        description:
          "Same accessType gate as GET /public/:token — the raw image bytes, not the JSON envelope. " +
          "404 if the form has no cover set.",
      },
    },
  )
  .get(
    "/slug/:slug/cover-image",
    async ({ params, currentUser }) => {
      const image = await formController.getCoverImageBySlug(params.slug, currentUser);
      return coverImageResponse(image);
    },
    {
      detail: {
        tags,
        summary: "Get a form's cover image by slug",
        description: "Same accessType gate as GET /slug/:slug.",
      },
    },
  );

const adminFormRoutes = new Elysia()
  .use(requireAuth)
  .get(
    "/",
    async ({ currentUser, query }) => {
      assertCurrentUser(currentUser);
      const folderId = typeof query.folderId === "string" ? parseIntParam(query.folderId, "folder id") : undefined;
      const data = await formController.list(currentUser.id, folderId);
      return successResponse("Forms loaded successfully", data);
    },
    { detail: { tags, security, summary: "List my forms" } },
  )
  .post(
    "/",
    async ({ body, currentUser, set }) => {
      assertCurrentUser(currentUser);
      const data = await formController.create(currentUser, body);
      set.status = 201;
      return successResponse("Form created successfully", data);
    },
    {
      body: createFormSchema,
      detail: { tags, security, summary: "Create a form, optionally with fields and options" },
    },
  )
  .get(
    "/:id",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await formController.getForEdit(id, currentUser.id);
      return successResponse("Form loaded successfully", data);
    },
    { detail: { tags, security, summary: "Get a form for editing (fields, options, allowed users)" } },
  )
  .patch(
    "/:id",
    async ({ params, body, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await formController.update(id, currentUser, body);
      return successResponse("Form updated successfully", data);
    },
    {
      body: updateFormSchema,
      detail: {
        tags,
        security,
        summary: "Update a form's settings, and optionally replace its fields",
        description:
          "Any provided `fields` array replaces the form's entire field list (and their options) in one " +
          "transaction. Refused with 400 once the form has responses, so editing unrelated settings never " +
          "cascade-deletes answers.",
      },
    },
  )
  .delete(
    "/:id",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      await formController.remove(id, currentUser.id);
      return successResponse("Form deleted successfully", null);
    },
    { detail: { tags, security, summary: "Delete a form" } },
  )
  .get(
    "/:id/cover-image",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const image = await formController.getCoverImageForEdit(id, currentUser.id);
      return coverImageResponse(image);
    },
    {
      detail: {
        tags,
        security,
        summary: "Get the cover image for a form I own (editor preview)",
        description: "The raw image bytes, not the JSON envelope. 404 if no cover is set.",
      },
    },
  )
  .post(
    "/:id/cover-image",
    async ({ params, body, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      const data = await formController.uploadCoverImage(id, currentUser.id, body);
      return successResponse("Cover image uploaded successfully", data);
    },
    {
      body: uploadCoverImageSchema,
      detail: {
        tags,
        security,
        summary: "Upload (or replace) a form's cover image",
        description:
          "multipart/form-data with a `file` field (png/jpeg/webp/gif, max 5MB). Stored in MinIO under a " +
          "generated key, never as a raw client-supplied URL; the previous cover (if any) is deleted.",
      },
    },
  )
  .delete(
    "/:id/cover-image",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "form id");
      await formController.removeCoverImage(id, currentUser.id);
      return successResponse("Cover image removed successfully", null);
    },
    { detail: { tags, security, summary: "Remove a form's cover image" } },
  )
  .patch(
    "/reorder",
    async ({ body, currentUser }) => {
      assertCurrentUser(currentUser);
      await formController.reorderForms(currentUser.id, body.folderId, body.formIds);
      return successResponse("Forms reordered successfully", null);
    },
    {
      body: reorderFormsSchema,
      detail: {
        tags,
        security,
        summary: "Reorder my forms within a folder (or at the root)",
        description:
          "formIds must match exactly the forms currently in that folder (folderId: null for root) — same " +
          "all-or-nothing semantics as field reordering. Never bumps updated_at.",
      },
    },
  )
  .post(
    "/:id/fields",
    async ({ params, body, currentUser, set }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      const data = await formController.addField(formId, currentUser.id, body);
      set.status = 201;
      return successResponse("Field added successfully", data);
    },
    { body: createFormFieldSchema, detail: { tags, security, summary: "Add a field to a form" } },
  )
  .patch(
    "/:id/fields/reorder",
    async ({ params, body, currentUser }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      await formController.reorderFields(formId, currentUser.id, body.fieldIds);
      return successResponse("Fields reordered successfully", null);
    },
    {
      body: reorderFieldsSchema,
      detail: { tags, security, summary: "Reorder a form's fields", description: "fieldIds must match the form's existing fields exactly." },
    },
  )
  .patch(
    "/:id/fields/:fieldId",
    async ({ params, body, currentUser }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      const fieldId = parseIntParam(params.fieldId, "field id");
      const data = await formController.updateField(formId, fieldId, currentUser.id, body);
      return successResponse("Field updated successfully", data);
    },
    { body: updateFormFieldSchema, detail: { tags, security, summary: "Update a field" } },
  )
  .delete(
    "/:id/fields/:fieldId",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      const fieldId = parseIntParam(params.fieldId, "field id");
      await formController.removeField(formId, fieldId, currentUser.id);
      return successResponse("Field deleted successfully", null);
    },
    { detail: { tags, security, summary: "Delete a field" } },
  )
  .post(
    "/:id/fields/:fieldId/options",
    async ({ params, body, currentUser, set }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      const fieldId = parseIntParam(params.fieldId, "field id");
      const data = await formController.addOption(formId, fieldId, currentUser.id, body);
      set.status = 201;
      return successResponse("Option added successfully", data);
    },
    { body: createFieldOptionSchema, detail: { tags, security, summary: "Add an option to a radio/checkbox field" } },
  )
  .delete(
    "/:id/fields/:fieldId/options/:optionId",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const formId = parseIntParam(params.id, "form id");
      const fieldId = parseIntParam(params.fieldId, "field id");
      const optionId = parseIntParam(params.optionId, "option id");
      await formController.removeOption(formId, fieldId, optionId, currentUser.id);
      return successResponse("Option deleted successfully", null);
    },
    { detail: { tags, security, summary: "Delete a field option" } },
  );

export const formRoutes = new Elysia({ prefix: "/forms" }).use(publicFormRoutes).use(adminFormRoutes);
