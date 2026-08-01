import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import pinoHttpModule from "pino-http";
import { config } from "./config/env.js";
import { logger } from "./config/logger.js";
import { registerSwagger } from "./docs/swagger.js";
import { errorMiddleware } from "./middleware/error.middleware.js";
import { requestIdMiddleware } from "./middleware/request-id.middleware.js";
import { testingRouter } from "./routes/testing.routes.js";

const pinoHttp = pinoHttpModule as unknown as typeof import("pino-http").default;

export function createApp(): express.Express {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger,
      customProps: (req) => ({ requestId: req.requestId }),
      redact: ["req.headers.authorization", "req.headers.cookie", "req.body.credentials"],
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.frontendOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
    }),
  );
  app.use(express.json({ limit: "512kb" }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  registerSwagger(app);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api/v1/testing", testingRouter);
  app.use(errorMiddleware);

  return app;
}
