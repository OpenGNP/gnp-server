import { analyticsService } from "../services/analyticsService";

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

  formTrend(formId: number, adminId: number) {
    return analyticsService.formTrend(formId, adminId);
  },
};
