import { faker } from "@faker-js/faker";

export class FormDataGenerator {
  private readonly targetHost: string;

  constructor(private readonly runId: string, targetHost = "example") {
    faker.seed(hashSeed(runId));
    this.targetHost = sanitizeHost(targetHost);
  }

  value(strategy?: string): string {
    const marker = `ZZTEST-${this.runId}`;
    switch (strategy) {
      case "VALID_FIRST_NAME":
        return `${faker.person.firstName()} ${marker}`;
      case "VALID_LAST_NAME":
        return `${faker.person.lastName()} ${marker}`;
      case "VALID_FULL_NAME":
        return `${faker.person.fullName()} ${marker}`;
      case "VALID_EMAIL":
        return `qa+${this.runId}@${this.targetHost}.test`;
      case "VALID_PHONE":
        return "+1-555-0101";
      case "VALID_PASSWORD":
        return `Aa1!${marker}`;
      case "VALID_DATE":
        return "2026-08-01";
      case "VALID_FUTURE_DATE":
        return "2027-08-01";
      case "VALID_PAST_DATE":
        return "2025-08-01";
      case "VALID_NUMBER":
        return "42";
      case "VALID_DECIMAL":
        return "42.50";
      case "VALID_ADDRESS":
        return `123 Test Street ${marker}`;
      case "VALID_POSTAL_CODE":
        return "02139";
      case "VALID_COMPANY":
        return `Test Company ${marker}`;
      case "VALID_DESCRIPTION":
        return `Safe automated test data ${marker}`;
      case "EMPTY_VALUE":
        return "";
      case "INVALID_EMAIL":
        return "not-an-email";
      case "INVALID_PHONE":
        return "123";
      case "TOO_SHORT":
        return "a";
      case "TOO_LONG":
        return `${"a".repeat(256)} ${marker}`;
      case "BELOW_MINIMUM":
        return "-1";
      case "ABOVE_MAXIMUM":
        return "999999";
      case "SPECIAL_CHARACTERS":
        return "!@#$%^&*()";
      case "SAFE_UNICODE":
        return `Cafe test ${marker}`;
      case "DUPLICATE_VALUE":
        return `duplicate-${marker}`;
      default:
        return `Safe automated test data ${marker}`;
    }
  }
}

function sanitizeHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "example";
}

function hashSeed(value: string): number {
  return [...value].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}
