import type { FastifyInstance } from "fastify";
import { getProvinceDetail, getWorldState, subscribeState } from "../services/worldState.js";

export async function worldRoutes(app: FastifyInstance) {
  app.get("/state", async () => getWorldState());

  // provinces.id is a TEXT slug (world-state keys), so the param check is the slug shape.
  const provinceParams = {
    params: { type: "object", required: ["provinceId"], properties: { provinceId: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]*$" } } },
  } as const;
  app.get("/provinces/:provinceId", { schema: provinceParams }, async (request) => {
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
