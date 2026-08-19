import type { CurrentUser } from "../middleware/authMiddleware";
import { feedbackService } from "../services/feedbackService";
import type { SubmitFeedbackInput } from "../validators/feedbackValidator";

export const feedbackController = {
  create(input: SubmitFeedbackInput, viewer: CurrentUser | null) {
    return feedbackService.create(input, viewer);
  },

  listByForm(formId: number, adminId: number) {
    return feedbackService.listByForm(formId, adminId);
  },

  getById(submissionId: number, adminId: number) {
    return feedbackService.getById(submissionId, adminId);
  },
};
