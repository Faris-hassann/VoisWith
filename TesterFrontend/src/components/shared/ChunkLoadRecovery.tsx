"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

const CHUNK_RELOAD_SESSION_KEY = "testerfrontend:chunk-reload-attempted";

export function ChunkLoadRecovery({ error }: { error: Error & { digest?: string } }) {
  const didAttemptReload = useRef(false);
  const isChunkLoadError = /chunkloaderror|loading chunk|failed to fetch dynamically imported module/i.test(
    `${error.name} ${error.message}`,
  );

  useEffect(() => {
    if (!isChunkLoadError || didAttemptReload.current) return;
    didAttemptReload.current = true;

    try {
      const alreadyRetried = window.sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY) === "true";
      if (alreadyRetried) return;
      window.sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, "true");
    } catch {
      // Ignore session storage failures and continue with a direct reload.
    }

    window.location.reload();
  }, [isChunkLoadError]);

  const retry = () => {
    try {
      window.sessionStorage.removeItem(CHUNK_RELOAD_SESSION_KEY);
    } catch {
      // Ignore session storage failures and continue with a direct reload.
    }
    window.location.reload();
  };

  return (
    <div className="mx-auto max-w-2xl rounded-lg border bg-card p-6 shadow-sm">
      <h1 className="text-xl font-semibold tracking-tight">
        {isChunkLoadError ? "Frontend bundle went stale" : "This page hit an unexpected error"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isChunkLoadError
          ? "The browser requested an older Next.js chunk after the dev/build output changed. Reloading picks up the fresh bundle."
          : "Reload the page to try again. If the error persists, check the frontend terminal for the underlying exception."}
      </p>
      <div className="mt-4 flex gap-3">
        <Button type="button" onClick={retry}>Reload page</Button>
      </div>
      <pre className="mt-4 overflow-auto rounded-md border bg-background p-3 text-xs text-muted-foreground">
        {error.name}: {error.message}
      </pre>
    </div>
  );
}
