import pino from "pino";
import { config } from "./env.js";
import { redactSecrets } from "../security/secret-redaction.js";

export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.OPENROUTER_API_KEY",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err(error) {
      return redactSecrets(pino.stdSerializers.err(error));
    },
  },
});
