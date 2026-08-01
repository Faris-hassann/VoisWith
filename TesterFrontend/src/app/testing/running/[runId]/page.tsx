import { EmptyState } from "@/components/shared/EmptyState";

export default function RunningPage() {
  return (
    <EmptyState
      title="Standalone running route unavailable"
      description="The backend currently returns a completed report from one long-running request, so progress is shown on the New Test page during submission."
    />
  );
}
