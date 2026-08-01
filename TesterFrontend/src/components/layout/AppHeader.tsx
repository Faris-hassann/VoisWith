"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { BackendStatus } from "./BackendStatus";

export function AppHeader() {
  const { theme, setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur">
      <div>
        <div className="text-sm font-semibold">Testing Console</div>
        <div className="text-xs text-muted-foreground">Backend-compatible prototype</div>
      </div>
      <div className="flex items-center gap-2">
        <BackendStatus />
        <Button variant="outline" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          <Sun className="h-4 w-4 dark:hidden" />
          <Moon className="hidden h-4 w-4 dark:block" />
        </Button>
      </div>
    </header>
  );
}
