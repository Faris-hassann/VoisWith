import type { Page } from "playwright";
import type { PerformanceObservation } from "../types/report.js";

export class PerformanceCollector {
  async collect(page: Page): Promise<PerformanceObservation[]> {
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return nav
        ? {
            domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
            load: nav.loadEventEnd - nav.startTime,
            duration: nav.duration,
          }
        : undefined;
    }).catch(() => undefined);

    if (!timing) return [];
    return [
      {
        name: "navigation-duration",
        valueMs: Math.round(timing.duration),
        description: "Initial navigation duration. This is not load testing.",
      },
      {
        name: "dom-content-loaded",
        valueMs: Math.round(timing.domContentLoaded),
        description: "DOM content loaded timing.",
      },
      {
        name: "load-event",
        valueMs: Math.round(timing.load),
        description: "Load event timing.",
      },
    ];
  }
}
