import { analyticsService, isTrendBucket } from "../services/analyticsService";

const parseMs = (value?: string): number | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
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

  formThemes(formId: number, adminId: number) {
    return analyticsService.formThemes(formId, adminId);
  },

  formTrend(
    formId: number,
    adminId: number,
    query: { from?: string; to?: string; bucket?: string } = {},
  ) {
    return analyticsService.formTrend(formId, adminId, {
      from: parseMs(query.from),
      to: parseMs(query.to),
      bucket: isTrendBucket(query.bucket) ? query.bucket : undefined,
    });
  },
};
