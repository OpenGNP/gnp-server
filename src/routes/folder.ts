import { Elysia } from "elysia";

import { folderController } from "../controllers/folderController";
import { assertCurrentUser, requireAuth } from "../middleware/authMiddleware";
import { parseIntParam } from "../utils/params";
import { successResponse } from "../utils/response";
import { createFolderSchema, updateFolderSchema } from "../validators/folderValidator";

const tags = ["Folders"];
const security = [{ bearerAuth: [] }];

export const folderRoutes = new Elysia({ prefix: "/folders" })
  .use(requireAuth)
  .get(
    "/",
    async ({ currentUser }) => {
      assertCurrentUser(currentUser);
      const data = await folderController.list(currentUser.id);
      return successResponse("Folders loaded successfully", data);
    },
    { detail: { tags, security, summary: "List my folders" } },
  )
  .get(
    "/:id",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "folder id");
      const data = await folderController.get(id, currentUser.id);
      return successResponse("Folder loaded successfully", data);
    },
    { detail: { tags, security, summary: "Get a folder and the forms inside it" } },
  )
  .post(
    "/",
    async ({ body, currentUser, set }) => {
      assertCurrentUser(currentUser);
      const data = await folderController.create(currentUser.id, body);
      set.status = 201;
      return successResponse("Folder created successfully", data);
    },
    { body: createFolderSchema, detail: { tags, security, summary: "Create a folder" } },
  )
  .patch(
    "/:id",
    async ({ params, body, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "folder id");
      const data = await folderController.update(id, currentUser.id, body);
      return successResponse("Folder updated successfully", data);
    },
    { body: updateFolderSchema, detail: { tags, security, summary: "Update a folder" } },
  )
  .delete(
    "/:id",
    async ({ params, currentUser }) => {
      assertCurrentUser(currentUser);
      const id = parseIntParam(params.id, "folder id");
      await folderController.remove(id, currentUser.id);
      return successResponse("Folder deleted successfully", null);
    },
    { detail: { tags, security, summary: "Delete a folder" } },
  );
