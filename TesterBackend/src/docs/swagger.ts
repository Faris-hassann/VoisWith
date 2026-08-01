import type { Express } from "express";
import swaggerUi from "swagger-ui-express";
import { openApiDocument } from "./openapi.js";

export function registerSwagger(app: Express): void {
  app.get("/", (_req, res) => {
    res.redirect("/docs");
  });

  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });

  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(openApiDocument, {
      customSiteTitle: "TesterBackend Swagger",
      swaggerOptions: {
        persistAuthorization: false,
        displayRequestDuration: true,
        tryItOutEnabled: true,
      },
    }),
  );
}
