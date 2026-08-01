import type { Page } from "playwright";
import type { ConsoleObservation } from "../types/report.js";
import { redactString } from "../security/secret-redaction.js";

export class ConsoleCollector {
  private readonly observations: ConsoleObservation[] = [];

  attach(page: Page): void {
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        this.observations.push({
          type: message.type(),
          text: redactString(message.text()).slice(0, 2000),
          location: message.location().url,
        });
      }
    });
    page.on("pageerror", (error) => {
      this.observations.push({
        type: "pageerror",
        text: redactString(error.message).slice(0, 2000),
      });
    });
    page.on("crash", () => {
      this.observations.push({ type: "crash", text: "Page crashed." });
    });
  }

  all(): ConsoleObservation[] {
    return [...this.observations];
  }

  errorsForUrl(url: string): ConsoleObservation[] {
    return this.observations.filter((item) => !item.location || item.location === url);
  }
}
