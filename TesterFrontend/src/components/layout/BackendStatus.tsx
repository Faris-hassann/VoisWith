"use client";

import { useQuery } from "@tanstack/react-query";
import { Wifi, WifiOff } from "lucide-react";
import { checkBackendHealth } from "@/lib/api/testing.api";
import { env } from "@/lib/environment/env";

export function BackendStatus() {
  const query = useQuery({
    queryKey: ["backend-health"],
    queryFn: checkBackendHealth,
    refetchInterval: 30000,
  });
  const connected = query.data === true;
  return (
    <div className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
      {connected ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-amber-500" />}
      <span>{env.mockMode ? "Mock Mode" : query.isLoading ? "Checking" : connected ? "Connected" : "Unreachable"}</span>
    </div>
  );
}
