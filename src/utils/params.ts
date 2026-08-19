import { badRequest } from "./errors";

export const parseIntParam = (value: string, label = "id") => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw badRequest(`Invalid ${label}`);
  }

  return parsed;
};
