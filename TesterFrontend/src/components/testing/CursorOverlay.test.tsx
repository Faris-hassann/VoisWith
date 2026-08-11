import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CursorOverlay } from "./CursorOverlay";

describe("CursorOverlay", () => {
  beforeEach(() => {
    class ResizeObserverMock {
      constructor(private readonly callback: () => void) {}
      observe() {
        this.callback();
      }
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("maps viewport coordinates into the object-contain rectangle", async () => {
    const { container } = render(
      <div style={{ width: 800, height: 400 }}>
        <CursorOverlay frameSrc="frame.jpg" cursor={{ x: 960, y: 540, action: "move" }} />
      </div>,
    );
    const host = container.querySelector(".relative.h-full.w-full") as HTMLDivElement;
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 400 });
    const image = screen.getByAltText("Live browser frame") as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 1600 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 1200 });
    fireEvent.load(image);

    await waitFor(() => {
      const dot = screen.getByTestId("cursor-dot");
      expect(Number.parseFloat(dot.style.left)).toBeCloseTo(453.3333333333333, 4);
      expect(Number.parseFloat(dot.style.top)).toBe(180);
    });
  });

  it("surfaces click and scroll animation states through the same overlay nodes", async () => {
    const { rerender } = render(
      <div style={{ width: 600, height: 300 }}>
        <CursorOverlay frameSrc="frame.jpg" cursor={{ x: 300, y: 150, action: "click" }} />
      </div>,
    );
    const host = document.querySelector(".relative.h-full.w-full") as HTMLDivElement;
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 300 });
    const image = screen.getAllByAltText("Live browser frame")[0] as HTMLImageElement;
    Object.defineProperty(image, "naturalWidth", { configurable: true, value: 600 });
    Object.defineProperty(image, "naturalHeight", { configurable: true, value: 300 });
    fireEvent.load(image);

    await waitFor(() => {
      expect(screen.getByTestId("cursor-dot")).toHaveAttribute("data-action", "click");
      expect(screen.getByTestId("cursor-pulse")).toHaveAttribute("data-action", "click");
    });

    rerender(
      <div style={{ width: 600, height: 300 }}>
        <CursorOverlay frameSrc="frame.jpg" cursor={{ x: 300, y: 150, action: "scroll" }} />
      </div>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("cursor-dot")).toHaveAttribute("data-action", "scroll");
      expect(screen.getByTestId("cursor-pulse")).toHaveAttribute("data-action", "scroll");
    });
  });
});
