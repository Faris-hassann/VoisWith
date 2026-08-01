const SECRET_KEYS = ["password", "token", "cookie", "authorization", "secret", "apiKey"];

export function redactSecrets<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.replace(/password=([^&\s]+)/gi, "password=[REDACTED]") as T;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))
      ? "[REDACTED]"
      : redactSecrets(nested);
  }
  return output as T;
}
