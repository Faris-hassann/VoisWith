import type { BrowserContext, Locator, Page } from "playwright";
import { config } from "../config/env.js";
import type { TestingRunRequest } from "../types/testing.js";

export type LiveCursorAction = "move" | "click" | "scroll";

export interface LiveCursorPayload {
  x: number;
  y: number;
  action: LiveCursorAction;
}

const CURSOR_HOST_ATTRIBUTE = "data-voiswith-live-cursor-host";
const CURSOR_BINDING_NAME = "__voiswithReportLiveCursor";
const CURSOR_CONTROLLER_NAME = "__voiswithLiveCursorController";
const suppressionDepth = new WeakMap<Page, number>();

const CURSOR_SCRIPT = `(() => {
  const hostAttribute = ${JSON.stringify(CURSOR_HOST_ATTRIBUTE)};
  const controllerName = ${JSON.stringify(CURSOR_CONTROLLER_NAME)};
  const bindingName = ${JSON.stringify(CURSOR_BINDING_NAME)};

  if (window[controllerName]?.version === 1) {
    window[controllerName].resume();
    return;
  }

  const state = {
    host: null,
    cursor: null,
    clickPulse: null,
    scrollPulse: null,
    x: 32,
    y: 32,
    detached: false,
    moveFrame: 0,
    scrollFrame: 0,
    clickTimer: 0,
    scrollTimer: 0,
    version: 1,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function ensureHost() {
    const root = document.documentElement;
    if (!root) return null;

    if (!state.host || !state.host.isConnected) {
      const host = document.createElement("div");
      host.setAttribute(hostAttribute, "true");
      host.setAttribute("aria-hidden", "true");
      host.tabIndex = -1;
      host.style.position = "fixed";
      host.style.left = "0";
      host.style.top = "0";
      host.style.width = "0";
      host.style.height = "0";
      host.style.pointerEvents = "none";
      host.style.zIndex = "2147483647";
      host.style.color = "transparent";
      host.style.background = "transparent";
      host.style.border = "0";
      host.style.outline = "0";
      host.style.boxShadow = "none";
      const shadowRoot = host.attachShadow({ mode: "closed" });
      const style = document.createElement("style");
      style.textContent = [
        ":host { all: initial; }",
        ".cursor {",
        "  position: fixed;",
        "  left: 0;",
        "  top: 0;",
        "  width: 18px;",
        "  height: 18px;",
        "  border: 2px solid rgba(255,255,255,0.98);",
        "  border-radius: 999px;",
        "  background: rgba(15, 23, 42, 0.88);",
        "  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.85), 0 8px 18px rgba(15, 23, 42, 0.35);",
        "  transform: translate3d(-50%, -50%, 0);",
        "  transition: transform 90ms ease, opacity 120ms ease;",
        "  pointer-events: none;",
        "  opacity: 1;",
        "}",
        ".cursor[data-clicking='true'] { transform: translate3d(-50%, -50%, 0) scale(1.18); }",
        ".pulse {",
        "  position: fixed;",
        "  left: 0;",
        "  top: 0;",
        "  width: 30px;",
        "  height: 30px;",
        "  border-radius: 999px;",
        "  border: 2px solid rgba(14, 165, 233, 0.9);",
        "  transform: translate3d(-50%, -50%, 0) scale(0.75);",
        "  opacity: 0;",
        "  transition: transform 180ms ease, opacity 180ms ease;",
        "  pointer-events: none;",
        "}",
        ".pulse[data-active='true'] {",
        "  opacity: 1;",
        "  transform: translate3d(-50%, -50%, 0) scale(1.15);",
        "}",
        ".pulse[data-kind='scroll'] { border-style: dashed; border-color: rgba(56, 189, 248, 0.95); }",
      ].join("\\n");
      const cursor = document.createElement("div");
      cursor.className = "cursor";
      cursor.setAttribute("aria-hidden", "true");
      const clickPulse = document.createElement("div");
      clickPulse.className = "pulse";
      clickPulse.setAttribute("data-kind", "click");
      clickPulse.setAttribute("aria-hidden", "true");
      const scrollPulse = document.createElement("div");
      scrollPulse.className = "pulse";
      scrollPulse.setAttribute("data-kind", "scroll");
      scrollPulse.setAttribute("aria-hidden", "true");
      shadowRoot.append(style, cursor, clickPulse, scrollPulse);
      state.host = host;
      state.cursor = cursor;
      state.clickPulse = clickPulse;
      state.scrollPulse = scrollPulse;
    }

    if (!state.detached && state.host && !state.host.isConnected) {
      root.appendChild(state.host);
    }
    return state.host;
  }

  function setPosition(x, y) {
    state.x = clamp(Math.round(x || 0), 0, Math.max(0, (window.innerWidth || 1) - 1));
    state.y = clamp(Math.round(y || 0), 0, Math.max(0, (window.innerHeight || 1) - 1));
    ensureHost();
    if (state.cursor) {
      state.cursor.style.left = state.x + "px";
      state.cursor.style.top = state.y + "px";
    }
    if (state.clickPulse) {
      state.clickPulse.style.left = state.x + "px";
      state.clickPulse.style.top = state.y + "px";
    }
    if (state.scrollPulse) {
      state.scrollPulse.style.left = state.x + "px";
      state.scrollPulse.style.top = state.y + "px";
    }
  }

  function report(action) {
    const binding = window[bindingName];
    if (typeof binding !== "function") return;
    void binding({ x: state.x, y: state.y, action }).catch(() => undefined);
  }

  function pulse(kind) {
    const target = kind === "click" ? state.clickPulse : state.scrollPulse;
    if (!target) return;
    target.setAttribute("data-active", "true");
    const timerKey = kind === "click" ? "clickTimer" : "scrollTimer";
    if (state[timerKey]) window.clearTimeout(state[timerKey]);
    state[timerKey] = window.setTimeout(() => target.setAttribute("data-active", "false"), kind === "click" ? 140 : 180);
  }

  function scheduleMove(x, y, action) {
    state.x = clamp(Math.round(x || 0), 0, Math.max(0, (window.innerWidth || 1) - 1));
    state.y = clamp(Math.round(y || 0), 0, Math.max(0, (window.innerHeight || 1) - 1));
    const frameKey = action === "scroll" ? "scrollFrame" : "moveFrame";
    if (state[frameKey]) return;
    state[frameKey] = window.requestAnimationFrame(() => {
      state[frameKey] = 0;
      setPosition(state.x, state.y);
      if (action === "scroll") pulse("scroll");
      report(action);
    });
  }

  function click(x, y) {
    setPosition(x, y);
    if (state.cursor) {
      state.cursor.setAttribute("data-clicking", "true");
      if (state.clickTimer) window.clearTimeout(state.clickTimer);
      state.clickTimer = window.setTimeout(() => state.cursor?.setAttribute("data-clicking", "false"), 140);
    }
    pulse("click");
    report("click");
  }

  function scroll() {
    const doc = document.documentElement;
    const maxScroll = Math.max(1, (doc?.scrollHeight || 1) - (window.innerHeight || 1));
    const ratio = maxScroll > 0 ? (window.scrollY || 0) / maxScroll : 0;
    const x = Math.max(24, (window.innerWidth || 48) - 28);
    const y = 24 + ratio * Math.max(24, (window.innerHeight || 96) - 48);
    scheduleMove(x, y, "scroll");
  }

  const controller = {
    version: 1,
    move(x, y) {
      scheduleMove(x, y, "move");
    },
    click,
    scroll,
    suspend() {
      state.detached = true;
      if (state.host?.isConnected) state.host.remove();
    },
    resume() {
      state.detached = false;
      setPosition(state.x, state.y);
    },
  };

  Object.defineProperty(window, controllerName, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: controller,
  });

  window.addEventListener("mousemove", (event) => controller.move(event.clientX, event.clientY), { passive: true });
  window.addEventListener("click", (event) => controller.click(event.clientX, event.clientY), { passive: true, capture: true });
  window.addEventListener("scroll", () => controller.scroll(), { passive: true });

  setPosition(Math.min(72, (window.innerWidth || 72) / 2), Math.min(72, (window.innerHeight || 72) / 2));
})()`;

export function shouldEnableLiveCursor(request: TestingRunRequest): boolean {
  return config.nodeEnv !== "production"
    && config.liveView.enabled
    && request.browserMode === "headed"
    && request.browser.headless === false
    && request.visualizationMode === "live";
}

export async function installLiveCursor(
  context: BrowserContext,
  page: Page,
  onCursor?: (payload: LiveCursorPayload) => void,
): Promise<void> {
  await context.exposeBinding(CURSOR_BINDING_NAME, (_source, payload: unknown) => {
    const normalized = normalizeCursorPayload(payload);
    if (normalized) onCursor?.(normalized);
  });
  await context.addInitScript(CURSOR_SCRIPT);
  await page.evaluate(CURSOR_SCRIPT).catch(() => undefined);
}

export async function withCursorSuppressed<T>(page: Page, operation: () => Promise<T>): Promise<T> {
  const nextDepth = (suppressionDepth.get(page) ?? 0) + 1;
  suppressionDepth.set(page, nextDepth);
  if (nextDepth === 1) {
    await setCursorSuppressed(page, true);
  }

  try {
    return await operation();
  } finally {
    const remaining = Math.max(0, (suppressionDepth.get(page) ?? 1) - 1);
    if (remaining === 0) {
      suppressionDepth.delete(page);
      await setCursorSuppressed(page, false);
    } else {
      suppressionDepth.set(page, remaining);
    }
  }
}

export async function scrollPageForDiscovery(page: Page): Promise<void> {
  if (typeof page.evaluate !== "function") return;
  await page.evaluate(
    async ({ controllerName }) => {
      const interactiveSelector = "a,button,input,textarea,select,form,[role='button'],[role='dialog'],[role='tab'],[role='menu'],[role='menuitem']";
      const viewport = window.innerHeight || 800;
      let stablePasses = 0;
      let previousHeight = 0;
      let previousInteractiveCount = 0;
      let y = 0;
      const controller = (window as unknown as Record<string, {
        scroll?: () => void;
      }>)[controllerName];
      window.scrollTo({ top: 0, behavior: "auto" });

      for (let index = 0; index < 80 && stablePasses < 3; index += 1) {
        const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
        const maxScrollTop = Math.max(0, height - viewport);
        window.scrollTo({ top: y, behavior: "auto" });
        controller?.scroll?.();
        await new Promise((resolve) => window.setTimeout(resolve, 220));
        const nextHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
        const interactiveCount = document.querySelectorAll(interactiveSelector).length;
        if (y >= maxScrollTop && nextHeight === previousHeight && interactiveCount === previousInteractiveCount) {
          stablePasses += 1;
        } else {
          stablePasses = 0;
        }
        previousHeight = nextHeight;
        previousInteractiveCount = interactiveCount;
        y = Math.min(Math.max(0, nextHeight - viewport), y + Math.max(240, Math.floor(viewport * 0.8)));
      }

      window.scrollTo({ top: 0, behavior: "auto" });
      controller?.scroll?.();
    },
    { controllerName: CURSOR_CONTROLLER_NAME },
  ).catch(() => undefined);
}

export async function moveCursorToLocator(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse?.move(x, y, { steps: 8 }).catch(() => undefined);
  await page.evaluate(
    ({ cursorX, cursorY, controllerName }) => {
      (window as unknown as Record<string, {
        move?: (x: number, y: number) => void;
      }>)[controllerName]?.move?.(cursorX, cursorY);
    },
    { cursorX: x, cursorY: y, controllerName: CURSOR_CONTROLLER_NAME },
  ).catch(() => undefined);
}

async function setCursorSuppressed(page: Page, suppressed: boolean): Promise<void> {
  const action = suppressed ? "suspend" : "resume";
  const run = async () => {
    await page.evaluate(
      ({ controllerName, controllerAction }: { controllerName: string; controllerAction: string }) => {
        const controller = (window as unknown as Record<string, {
          suspend?: () => void;
          resume?: () => void;
        }>)[controllerName];
        if (controllerAction === "suspend" || controllerAction === "resume") {
          controller?.[controllerAction]?.();
        }
      },
      { controllerName: CURSOR_CONTROLLER_NAME, controllerAction: action },
    );
  };

  try {
    await run();
  } catch {
    if (!suppressed) {
      await page.waitForLoadState("domcontentloaded", { timeout: 1000 }).catch(() => undefined);
      await run().catch(() => undefined);
    }
  }
}

function normalizeCursorPayload(payload: unknown): LiveCursorPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const action = record.action;
  if (action !== "move" && action !== "click" && action !== "scroll") return undefined;
  const x = Number(record.x);
  const y = Number(record.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y), action };
}

declare global {
  interface Window {
    __voiswithLiveCursorController?: {
      version: number;
      move?: (x: number, y: number) => void;
      click?: (x: number, y: number) => void;
      scroll?: () => void;
      suspend?: () => void;
      resume?: () => void;
    };
    __voiswithReportLiveCursor?: (payload: LiveCursorPayload) => Promise<void>;
  }
}

export { CURSOR_HOST_ATTRIBUTE };
