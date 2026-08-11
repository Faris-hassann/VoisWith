"use client";

import { useEffect } from "react";
import { ChunkLoadRecovery } from "@/components/shared/ChunkLoadRecovery";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-background p-4 lg:p-6">
        <div className="mx-auto max-w-7xl">
          <ChunkLoadRecovery error={error} />
          <button type="button" onClick={reset} className="sr-only">
            Reset
          </button>
        </div>
      </body>
    </html>
  );
}
