"use client";

import { Toaster } from "sonner";
import type { ReactNode } from "react";
import { QueryProvider } from "./query-provider";
import { ReportStoreProvider } from "./report-store-provider";
import { ThemeProvider } from "./theme-provider";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <QueryProvider>
        <ReportStoreProvider>
          {children}
          <Toaster richColors position="top-right" />
        </ReportStoreProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
