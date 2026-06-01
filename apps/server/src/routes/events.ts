import type { FastifyInstance } from "fastify";
import { applyEventChoice, listEvents } from "../services/eventEngine.js";

export async function eventRoutes(app: FastifyInstance) {
  app.get("/", async () => listEvents());

  app.post("/:eventId/choices/:choiceId", async (request) => {
    const { eventId, choiceId } = request.params as { eventId: string; choiceId: string };
    return applyEventChoice(eventId, choiceId);
  });
}
