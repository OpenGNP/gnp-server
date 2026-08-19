import { Elysia } from "elysia";

import { AppError } from "../utils/errors";
import { errorResponse } from "../utils/response";

/** Elysia's VALIDATION error message is a JSON dump of the failing field; surface just the useful part. */
function describeValidationError(rawMessage: string): string {
  try {
    const detail = JSON.parse(rawMessage) as { property?: string; message?: string };
    if (detail.property && detail.message) {
      return `${detail.property}: ${detail.message}`;
    }
  } catch {
    // fall through to the generic message below
  }
  return "Invalid request payload";
}

export const errorMiddleware = new Elysia({ name: "error-middleware" })
  .onError({ as: "global" }, ({ code, error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status;
      return errorResponse(error.message);
    }

    if (code === "VALIDATION") {
      set.status = 400;
      return errorResponse(describeValidationError(error.message));
    }

    if (code === "NOT_FOUND") {
      set.status = 404;
      return errorResponse("Not found");
    }

    console.error(error);
    set.status = 500;
    return errorResponse("Internal server error");
  });
