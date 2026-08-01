import type { RunStatus, TestStatus, IssueSeverity } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ value }: { value: RunStatus | TestStatus | IssueSeverity | string }) {
  const normalized = value.toUpperCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        ["PASSED", "LOW"].includes(normalized) && "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
        ["FAILED", "ERROR", "CRITICAL", "HIGH"].includes(normalized) && "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
        ["SKIPPED", "MEDIUM", "PARTIAL"].includes(normalized) && "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
        normalized === "BLOCKED_BY_POLICY" && "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
        ["INCONCLUSIVE", "INFORMATIONAL"].includes(normalized) && "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
      )}
    >
      <span className="sr-only">Status </span>
      {value.replaceAll("_", " ")}
    </span>
  );
}
