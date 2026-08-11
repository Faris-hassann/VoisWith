import type { FormFieldSnapshot } from "../types/llm-contract.js";

export type FieldIntent =
  | "email"
  | "phone"
  | "postal"
  | "first_name"
  | "last_name"
  | "full_name"
  | "company"
  | "address"
  | "description"
  | "password"
  | "date"
  | "number"
  | "unknown";

/** Small, auditable semantic signal list used by the deterministic fallback. */
export function inferFieldIntent(field: FormFieldSnapshot): FieldIntent {
  const type = field.type?.trim().toLowerCase();
  if (type === "email") return "email";
  if (type === "tel") return "phone";
  if (type === "password") return "password";
  if (type === "date" || type === "datetime-local") return "date";
  if (type === "number" || type === "range") return "number";

  const descriptor = [field.name, field.label, field.placeholder]
    .filter(Boolean)
    .join(" ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  if (/\be\s*mail\b/.test(descriptor)) return "email";
  if (/\b(phone|tel|telephone|mobile|cell)\b/.test(descriptor)) return "phone";
  if (/\b(zip|postal|postcode|post code)\b/.test(descriptor)) return "postal";
  if (/\b(first|given)\s+name\b/.test(descriptor)) return "first_name";
  if (/\b(last|family|sur)\s*name\b/.test(descriptor)) return "last_name";
  if (/\b(full\s+name|your\s+name|contact\s+name)\b/.test(descriptor)) return "full_name";
  if (/\b(company|organisation|organization|business)\b/.test(descriptor)) return "company";
  if (/\b(address|street)\b/.test(descriptor)) return "address";
  if (/\b(message|description|details|comments?|notes?)\b/.test(descriptor)) return "description";
  return "unknown";
}
