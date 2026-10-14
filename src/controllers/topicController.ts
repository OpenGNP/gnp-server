import { topicService } from "../services/topicService";

export const topicController = {
  list() {
    return topicService.list();
  },

  get(id: number) {
    return topicService.getById(id);
  },
};
