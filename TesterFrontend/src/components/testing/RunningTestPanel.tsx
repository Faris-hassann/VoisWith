"use client";

import { MonitorPlay } from "lucide-react";
import type { RunProgressEvent } from "@/lib/api/types";
import { CursorOverlay } from "./CursorOverlay";

export function RunningTestPanel({
  frameSrc,
  cursor,
}: {
  frameSrc?: string;
  cursor?: RunProgressEvent["liveCursor"];
}) {
  return (
    <div className="rounded-lg border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <MonitorPlay className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Live browser</h2>
      </div>
      <div className="mt-3 aspect-video overflow-hidden rounded-md border bg-background">
        {frameSrc ? (
          <CursorOverlay frameSrc={frameSrc} cursor={cursor} />
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted-foreground">Waiting for live-view frames.</div>
        )}
      </div>
    </div>
  );
}
