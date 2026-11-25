import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type { Monitor } from "@tauri-apps/api/window";
import type { PetPress } from "./FloatingPet";
import { isSpritePixel } from "./PixelPet";

interface Point { x: number; y: number }

const positionKey = "yuna.desktop-pet.position";

function readPosition(): Point | null {
  try {
    const position = JSON.parse(localStorage.getItem(positionKey) ?? "null");
    if (Number.isFinite(position?.x) && Number.isFinite(position?.y)) return position;
  } catch {
    // A missing or invalid position falls back to the current monitor.
  }
  return null;
}

function savePosition(point: Point) {
  try {
    localStorage.setItem(positionKey, JSON.stringify(point));
  } catch {
    // The active session still retains the position.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function contains(monitor: Monitor, point: Point) {
  const { position, size } = monitor.workArea;
  return point.x >= position.x && point.y >= position.y &&
    point.x < position.x + size.width && point.y < position.y + size.height;
}

function overPet(button: HTMLButtonElement, x: number, y: number) {
  const sprite = button.querySelector("canvas")?.getBoundingClientRect();
  if (sprite && isSpritePixel((x - sprite.left) / sprite.width, (y - sprite.top) / sprite.height)) return true;
  const badge = button.querySelector("[data-pet-badge]")?.getBoundingClientRect();
  return !!badge && Math.hypot(x - badge.left - badge.width / 2, y - badge.top - badge.height / 2) <= badge.width / 2;
}

export function useDesktopWindow({
  native, enabled, compact, wrap, surface, press,
}: {
  native: boolean;
  enabled: boolean;
  compact: boolean;
  wrap: RefObject<HTMLDivElement>;
  surface: RefObject<HTMLButtonElement>;
  press: MutableRefObject<PetPress | null>;
}) {
  const position = useRef<Point | null>(null);
  const pendingLayout = useRef<Promise<void>>(Promise.resolve());
  const pendingPointer = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (native) position.current = readPosition();
  }, [native]);

  useEffect(() => {
    const element = wrap.current;
    if (!native || !element) return;
    let stopped = false;
    let frame = 0;

    const scheduleFit = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        pendingLayout.current = pendingLayout.current.then(async () => {
          if (stopped || press.current) return;
          const { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } = await import("@tauri-apps/api/window");
          const win = getCurrentWindow();
          const [monitors, current, origin, size, scale] = await Promise.all([
            availableMonitors(), currentMonitor(), win.innerPosition(), win.innerSize(), win.scaleFactor(),
          ]);
          if (stopped || press.current) return;
          const anchor = enabled ? position.current : null;
          const monitor = (anchor && monitors.find((candidate) => contains(candidate, anchor))) ?? current ?? monitors[0];
          if (!monitor) return;
          const bounds = element.getBoundingClientRect();
          const width = Math.ceil(bounds.width) + (compact ? 0 : 32);
          const height = Math.ceil(bounds.height) + (compact ? 0 : 24);
          const area = monitor.workArea;
          const physicalWidth = Math.round(width * monitor.scaleFactor);
          const physicalHeight = Math.round(height * monitor.scaleFactor);
          const preferred = anchor && contains(monitor, anchor) ? anchor : {
            x: Math.round(area.position.x + (area.size.width - physicalWidth) / 2),
            y: area.position.y + 6,
          };
          const next = {
            x: clamp(preferred.x, area.position.x, area.position.x + area.size.width - physicalWidth),
            y: clamp(preferred.y, area.position.y, area.position.y + area.size.height - physicalHeight),
          };
          if (size.width !== Math.round(width * scale) || size.height !== Math.round(height * scale)) {
            await win.setSize(new LogicalSize(width, height));
          }
          if (stopped || press.current) return;
          if (next.x !== origin.x || next.y !== origin.y) {
            await win.setPosition(new PhysicalPosition(next.x, next.y));
          }
          if (!stopped && compact && (next.x !== anchor?.x || next.y !== anchor?.y)) {
            position.current = next;
            savePosition(next);
          }
        }).catch((error: unknown) => console.warn("Yuna could not fit the desktop window", error));
      });
    };

    const observer = new ResizeObserver(scheduleFit);
    observer.observe(element);
    // This also checks the anchor after a monitor or work area disappears.
    const monitorTimer = enabled ? window.setInterval(scheduleFit, 2500) : undefined;
    scheduleFit();
    return () => {
      stopped = true;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
      window.clearInterval(monitorTimer);
    };
  }, [native, enabled, compact, wrap, press]);

  useEffect(() => {
    if (!native || !compact) return;
    let stopped = false;
    let timer = 0;
    let ignored = false;

    async function poll() {
      if (stopped || !surface.current) return;
      const { cursorPosition, getCurrentWindow, PhysicalPosition } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const [cursor, origin, scale] = await Promise.all([cursorPosition(), win.innerPosition(), win.scaleFactor()]);
      const button = surface.current;
      if (stopped || !button) return;
      const activePress = press.current;
      if (activePress?.dragging) {
        const next = {
          x: Math.round(cursor.x - activePress.x * scale),
          y: Math.round(cursor.y - activePress.y * scale),
        };
        if (next.x !== origin.x || next.y !== origin.y) {
          await win.setPosition(new PhysicalPosition(next.x, next.y));
          if (!stopped) {
            position.current = next;
            savePosition(next);
          }
        }
      }
      const ignore = !activePress && !overPet(button, (cursor.x - origin.x) / scale, (cursor.y - origin.y) / scale);
      if (ignore !== ignored) {
        await win.setIgnoreCursorEvents(ignore);
        ignored = ignore;
      }
    }

    async function restoreInput() {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setIgnoreCursorEvents(false);
    }

    function tick() {
      pendingPointer.current = pendingPointer.current.then(poll).then(() => {
        if (!stopped) timer = window.setTimeout(tick, 32);
      }).catch(async (error: unknown) => {
        console.warn("Yuna could not track the desktop pointer", error);
        await restoreInput().catch(() => {});
      });
    }

    tick();
    return () => {
      stopped = true;
      press.current = null;
      window.clearTimeout(timer);
      pendingPointer.current = pendingPointer.current.then(restoreInput).catch((error: unknown) => {
        console.warn("Yuna could not restore desktop pointer input", error);
      });
    };
  }, [native, compact, surface, press]);
}
