import { Elysia } from "elysia";

export const loggerMiddleware = new Elysia({ name: "logger-middleware" })
  .onRequest(({ request }) => {
    console.log(`${request.method} ${new URL(request.url).pathname}`);
  });
