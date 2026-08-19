import { analyticsService } from "../services/analyticsService";

export const analyticsController = {
  summary(adminId: number) {
    return analyticsService.summary(adminId);
  },

  trends(limit?: number) {
    return analyticsService.trends(limit);
  },
};
