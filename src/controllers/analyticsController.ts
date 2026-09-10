import { analyticsService, isTrendBucket, isTrendRank } from "../services/analyticsService";

const parseMs = (value?: string): number | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

/** "12,45,7" → [12, 45, 7] (positive integers only). */
const parseIds = (value?: string): number[] | undefined => {
  if (!value) return undefined;
  const ids = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return ids.length > 0 ? ids : undefined;
};

export const analyticsController = {
  summary(adminId: number) {
    return analyticsService.summary(adminId);
  },

  trends(limit?: number) {
    return analyticsService.trends(limit);
  },

  formResponses(formId: number, adminId: number) {
    return analyticsService.formResponses(formId, adminId);
  },

  formThemes(
    formId: number,
    adminId: number,
    query: { from?: string; to?: string } = {},
  ) {
    return analyticsService.formThemes(formId, adminId, {
      from: parseMs(query.from),
      to: parseMs(query.to),
    });
  },

  formTrend(
    formId: number,
    adminId: number,
    query: {
      from?: string;
      to?: string;
      bucket?: string;
      rank?: string;
      topics?: string;
    } = {},
  ) {
    return analyticsService.formTrend(formId, adminId, {
      from: parseMs(query.from),
      to: parseMs(query.to),
      bucket: isTrendBucket(query.bucket) ? query.bucket : undefined,
      rank: isTrendRank(query.rank) ? query.rank : undefined,
      topics: parseIds(query.topics),
    });
  },
};
