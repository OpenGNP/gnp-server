import { openapi } from "@elysiajs/openapi";

import { AUTH_COOKIE_NAME } from "../utils/cookies";

export const apiDocs = openapi({
  path: "/docs",
  documentation: {
    info: {
      title: "GNP API",
      description:
        "Backend API for the GNP feedback platform: forms, submissions, AI-derived topics/points, and analytics. " +
        "Most endpoints require auth, either a Bearer token or the auth cookie, both issued by " +
        "/api/auth/login or /api/auth/register.",
      version: "1.0.0",
    },
    tags: [
      { name: "Auth", description: "Registration, login, and logout" },
      { name: "Users", description: "The authenticated user and organization members" },
      { name: "Organizations", description: "Organizations available at registration" },
      { name: "Folders", description: "Folders that group forms, owned by an admin" },
      { name: "Forms", description: "Form authoring, field/option management, and the public respondent view" },
      { name: "Feedback", description: "Submitting and reviewing form responses" },
      { name: "Topics", description: "AI-derived canonical topics and their trends" },
      { name: "Analytics", description: "Aggregate dashboards over an admin's forms" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Token returned by /api/auth/login or /api/auth/register",
        },
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: AUTH_COOKIE_NAME,
          description: "httpOnly cookie set by /api/auth/login or /api/auth/register",
        },
      },
    },
  },
});
