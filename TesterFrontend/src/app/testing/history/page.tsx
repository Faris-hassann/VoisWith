import { EmptyState } from "@/components/shared/EmptyState";

export default function HistoryPage() {
  return (
    <EmptyState
      title="History unavailable"
      description="The backend currently exposes only a long-running test endpoint and does not provide report persistence or history APIs. This page will light up when a backend history endpoint exists."
    />
  );
}
