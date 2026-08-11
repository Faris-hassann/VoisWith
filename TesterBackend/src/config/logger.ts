import pino from "pino";
import { config } from "./env.js";
import { redactSecrets } from "../security/secret-redaction.js";
import { serializeError } from "../errors/serialize-error.js";

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
      "*.QWEN_API_KEY",
    ],
    censor: "[REDACTED]",
  },
  serializers: {
    err(error) {
      const serialized = pino.stdSerializers.err(error);
      return redactSecrets(serialized.message ? serialized : serializeError(error));
    },
  },
});
