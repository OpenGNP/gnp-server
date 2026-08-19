export class AppError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

/** Postgres unique_violation (23505), surfaced through Drizzle's wrapped query error `.cause`. */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "cause" in error &&
  typeof error.cause === "object" &&
  error.cause !== null &&
  "code" in error.cause &&
  error.cause.code === "23505";

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = "Unauthorized") => new AppError(401, message);
export const forbidden = (message = "Forbidden") => new AppError(403, message);
export const notFound = (message: string) => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);
