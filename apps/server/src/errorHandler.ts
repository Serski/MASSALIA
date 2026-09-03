import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";

// One error shape for every route: `{ error: string }`.
//   * 4xx — a thrown `{ statusCode }` error (requireAuth's 401, a StoryRuleError,
//     a schema validation failure's 400) keeps its status and its message.
//   * 5xx (or no statusCode at all) — logged with the stack, answered with a fixed
//     message so no internal detail (SQL, file paths, stack frames) reaches a client.
export function errorHandler(error: FastifyError | (Error & { statusCode?: number }), request: FastifyRequest, reply: FastifyReply) {
  const statusCode = typeof error.statusCode === "number" && error.statusCode >= 400 ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error(error);
    return reply.code(statusCode).send({ error: "Something went wrong." });
  }
  return reply.code(statusCode).send({ error: error.message });
}
