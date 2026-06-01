import type { FastifyInstance } from "fastify";
import { getProvinceDetail, getWorldState, subscribeState } from "../services/worldState.js";

export async function worldRoutes(app: FastifyInstance) {
  app.get("/state", async () => getWorldState());

  app.get("/provinces/:provinceId", async (request) => {
    const { provinceId } = request.params as { provinceId: string };
    return getProvinceDetail(provinceId);
  });

  app.get("/stream", async (_request, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = async () => {
      reply.raw.write(`event: state\n`);
      reply.raw.write(`data: ${JSON.stringify(await getWorldState())}\n\n`);
    };

    await send();
    const unsubscribe = subscribeState(send);
    reply.raw.on("close", unsubscribe);
  });
}
