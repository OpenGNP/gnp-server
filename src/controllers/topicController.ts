import { topicService } from "../services/topicService";
import type { CreateTopicInput } from "../validators/topicValidator";

export const topicController = {
  list() {
    return topicService.list();
  },

  get(id: number) {
    return topicService.getById(id);
  },

  create(input: CreateTopicInput) {
    return topicService.create(input);
  },
};
