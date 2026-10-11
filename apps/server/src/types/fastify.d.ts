import type { AuthSession } from "../auth/sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    authSession?: AuthSession;
  }
}
