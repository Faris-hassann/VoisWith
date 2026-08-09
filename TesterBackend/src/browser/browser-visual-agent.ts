import type { Locator, Page } from "playwright";

const CURSOR_SCRIPT = `(() => {
  const CURSOR_ID = "__voiswith_visible_cursor";
  const STYLE_ID = "__voiswith_visible_cursor_style";

  function ensureCursor() {
    // addInitScript runs at document-start, before <head> exists. Without this
    // guard the overlay threw "Cannot read properties of null (appendChild)"
    // into the page console on every navigation — and the CONSOLE_ERRORS check
    // then reported our own decoration as a defect in the target.
    const styleHost = document.head || document.documentElement;
    const cursorHost = document.documentElement || document.body;
    if (!styleHost || !cursorHost) return null;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = [
        "#" + CURSOR_ID + " {",
        "  position: fixed;",
        "  left: 0;",
        "  top: 0;",
        "  width: 18px;",
        "  height: 18px;",
        "  border: 2px solid #ffffff;",
        "  border-radius: 999px;",
        "  background: rgba(15, 23, 42, 0.88);",
        "  box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.85), 0 8px 18px rgba(15, 23, 42, 0.35);",
        "  pointer-events: none;",
        "  z-index: 2147483647;",
        "  transform: translate(-50%, -50%);",
        "  transition: left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease;",
        "}",
        "#" + CURSOR_ID + "[data-active='true'] {",
        "  width: 24px;",
        "  height: 24px;",
        "}",
      ].join("\\n");
      styleHost.appendChild(style);
    }

    let cursor = document.getElementById(CURSOR_ID);
    if (!cursor) {
      cursor = document.createElement("div");
      cursor.id = CURSOR_ID;
      cursor.setAttribute("aria-hidden", "true");
      cursorHost.appendChild(cursor);
    }
    return cursor;
  }

  function move(x, y, active) {
    const cursor = ensureCursor();
    if (!cursor) return;
    cursor.style.left = Math.max(0, Math.round(x)) + "px";
    cursor.style.top = Math.max(0, Math.round(y)) + "px";
    cursor.dataset.active = active ? "true" : "false";
  }

  window.__voiswithCursorMove = move;
  window.addEventListener("mousemove", (event) => move(event.clientX, event.clientY, false), { passive: true });
  move(Math.min(72, window.innerWidth / 2), Math.min(72, window.innerHeight / 2), false);
})()`;

export async function installVisibleCursor(page: Page): Promise<void> {
  if (typeof page.addInitScript !== "function" || typeof page.evaluate !== "function") return;
  await page.addInitScript(CURSOR_SCRIPT);
  await page.evaluate(CURSOR_SCRIPT).catch(() => undefined);
}

export async function scrollPageForDiscovery(page: Page): Promise<void> {
  if (typeof page.evaluate !== "function") return;
  await page.evaluate(async () => {
    const interactiveSelector = "a,button,input,textarea,select,form,[role='button'],[role='dialog'],[role='tab'],[role='menu'],[role='menuitem']";
    const viewport = window.innerHeight || 800;
    let stablePasses = 0;
    let previousHeight = 0;
    let previousInteractiveCount = 0;
    let y = 0;
    window.scrollTo({ top: 0, behavior: "auto" });

    for (let index = 0; index < 80 && stablePasses < 3; index += 1) {
      const height = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
      const maxScrollTop = Math.max(0, height - viewport);
      window.scrollTo({ top: y, behavior: "auto" });
      if (typeof window.__voiswithCursorMove === "function") {
        window.__voiswithCursorMove(Math.max(24, window.innerWidth - 42), Math.min(window.innerHeight - 24, 90 + index * 24), false);
      }
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
  }).catch(() => undefined);
}

export async function moveCursorToLocator(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox().catch(() => null);
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse?.move(x, y, { steps: 8 }).catch(() => undefined);
  if (typeof page.evaluate !== "function") return;
  await page.evaluate(
    ({ x: cursorX, y: cursorY }) => {
      if (typeof window.__voiswithCursorMove === "function") {
        window.__voiswithCursorMove(cursorX, cursorY, true);
        window.setTimeout(() => window.__voiswithCursorMove?.(cursorX, cursorY, false), 180);
      }
    },
    { x, y },
  ).catch(() => undefined);
}

declare global {
  interface Window {
    __voiswithCursorMove?: (x: number, y: number, active?: boolean) => void;
  }
}
