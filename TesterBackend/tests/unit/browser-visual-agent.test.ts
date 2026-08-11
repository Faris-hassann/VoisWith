import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactManager } from "../../src/artifacts/artifact-manager.js";
import {
  installLiveCursor,
  scrollPageForDiscovery,
  shouldEnableLiveCursor,
} from "../../src/browser/browser-visual-agent.js";
import { ElementInventoryBuilder } from "../../src/inspection/element-inventory.js";
import type { TestingRunRequest } from "../../src/types/testing.js";

describe("browser live cursor overlay", () => {
  let browser: Browser | undefined;
  let tempRoot: string | undefined;

  afterEach(async () => {
    await browser?.close().catch(() => undefined);
    browser = undefined;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  it("enables only in development headed live mode", () => {
    expect(shouldEnableLiveCursor(requestFor())).toBe(true);
    expect(shouldEnableLiveCursor(requestFor({
      browserMode: "headless",
      browser: { channel: "chrome", headless: true, viewport: { width: 1280, height: 720 } },
    }))).toBe(false);
    expect(shouldEnableLiveCursor(requestFor({ visualizationMode: "local" }))).toBe(false);
    expect(shouldEnableLiveCursor(requestFor({ visualizationMode: "off" }))).toBe(false);
  });

  it("emits ordered move, click, and scroll cursor events", async () => {
    browser = await launchBrowser();
    if (!browser) return;
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
    const page = await context.newPage();
    const seen: Array<{ action: string; x: number; y: number }> = [];
    await installLiveCursor(context, page, (payload) => seen.push(payload));
    await page.setContent("<!doctype html><html><body style='margin:0;height:2200px;background:#fff'><button id='go' style='margin:120px'>Go</button></body></html>");
    await page.evaluate(() => {
      window.__voiswithLiveCursorController?.move?.(160, 150);
      window.__voiswithLiveCursorController?.click?.(160, 150);
    });
    await scrollPageForDiscovery(page);
    await page.waitForTimeout(300);

    expect(seen.some((event) => event.action === "move")).toBe(true);
    expect(seen.some((event) => event.action === "click")).toBe(true);
    expect(seen.some((event) => event.action === "scroll")).toBe(true);
    expect(seen.every((event) => Number.isInteger(event.x) && Number.isInteger(event.y))).toBe(true);
  });

  it("keeps element inventory identical with the overlay enabled", async () => {
    browser = await launchBrowser();
    if (!browser) return;
    const html = "<!doctype html><html><body><main><button aria-label='Save'>Save</button><input name='email' type='text' placeholder='Email' /></main></body></html>";

    const baselineContext = await browser.newContext();
    const baselinePage = await baselineContext.newPage();
    await baselinePage.setContent(html);
    const baseline = await new ElementInventoryBuilder().build(baselinePage);
    await baselineContext.close();

    const overlayContext = await browser.newContext();
    const overlayPage = await overlayContext.newPage();
    await installLiveCursor(overlayContext, overlayPage);
    await overlayPage.setContent(html);
    const withOverlay = await new ElementInventoryBuilder().build(overlayPage);

    expect(withOverlay).toEqual(baseline);
  });

  it("omits the overlay from persisted screenshots", async () => {
    browser = await launchBrowser();
    if (!browser) return;
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
    const page = await context.newPage();
    await installLiveCursor(context, page);
    await page.setContent("<!doctype html><html><body style='margin:0;background:#fff;height:100vh'></body></html>");
    await page.evaluate(() => {
      window.__voiswithLiveCursorController?.move?.(180, 140);
    });
    await page.waitForTimeout(200);

    const control = await page.screenshot({ type: "jpeg", quality: 70 });
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-artifacts-"));
    const manager = new ArtifactManager(tempRoot, "run_1");
    await manager.initialize();
    const evidence = await manager.screenshot(page, "suppressed", "suppressed screenshot");
    const suppressed = await fs.readFile(path.resolve(evidence.path));

    const controlPixels = await countNonWhitePixels(page, control, { x: 180, y: 140, radius: 28 });
    const suppressedPixels = await countNonWhitePixels(page, suppressed, { x: 180, y: 140, radius: 28 });

    expect(controlPixels).toBeGreaterThan(150);
    expect(suppressedPixels).toBeLessThan(20);
  });
});

function requestFor(overrides: Partial<TestingRunRequest> & {
  browser?: Partial<TestingRunRequest["browser"]>;
} = {}): TestingRunRequest {
  return {
    targetUrl: "https://example.com",
    authorizationConfirmed: true,
    environment: "staging",
    browserMode: "headed",
    visualizationMode: "live",
    testTypes: ["SMOKE"],
    crawl: { strategy: "DFS", maxDepth: 1, maxPages: 1, sameOriginOnly: true, includePatterns: [], excludePatterns: [] },
    browser: {
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 720 },
      ...overrides.browser,
    },
    execution: {
      safeMode: true,
      allowFormSubmission: false,
      allowFileUploads: false,
      allowDestructiveActions: false,
      allowPayments: false,
      maximumActionsPerPage: 5,
      maximumRunDurationSeconds: 60,
    },
    ...overrides,
  };
}

async function countNonWhitePixels(
  page: Page,
  buffer: Buffer,
  region: { x: number; y: number; radius: number },
): Promise<number> {
  return page.evaluate(
    async ({ dataUrl, region }) => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("Failed to decode screenshot."));
        element.src = dataUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas context unavailable.");
      context.drawImage(img, 0, 0);
      const left = Math.max(0, Math.round(region.x - region.radius));
      const top = Math.max(0, Math.round(region.y - region.radius));
      const size = Math.max(1, Math.round(region.radius * 2));
      const pixels = context.getImageData(left, top, size, size).data;
      let count = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index] ?? 255;
        const g = pixels[index + 1] ?? 255;
        const b = pixels[index + 2] ?? 255;
        if (Math.abs(255 - r) > 18 || Math.abs(255 - g) > 18 || Math.abs(255 - b) > 18) {
          count += 1;
        }
      }
      return count;
    },
    {
      dataUrl: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      region,
    },
  );
}

async function launchBrowser(): Promise<Browser | undefined> {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    try {
      return await chromium.launch({ headless: true });
    } catch {
      return undefined;
    }
  }
}
