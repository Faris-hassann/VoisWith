const SENSITIVE_KEYS = [
  "password",
  "passwd",
  "secret",
  "token",
  "api_key",
  "apikey",
  "authorization",
  "cookie",
  "set-cookie",
  "openrouter_api_key",
  "access_token",
  "refresh_token",
  "session",
];

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /sk-or-[A-Za-z0-9_-]+/g,
  /api[_-]?key=([^&\s]+)/gi,
  /password=([^&\s]+)/gi,
  /token=([^&\s]+)/gi,
];

export function redactString(value: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, "[REDACTED]"), value);
}

export function redactSecrets<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactString(input) as T;
  if (typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactSecrets(item)) as T;

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactSecrets(value);
    }
  }
  return output as T;
}
