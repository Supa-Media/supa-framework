/**
 * Types for `@supa-media/desktop/electron`.
 *
 * `electron` is an optional peer dependency, so these declarations reference it
 * through `import("electron")` inside the types that need it. An app that does
 * not install Electron never loads this entry point and never resolves them.
 */

import type { PermissionBroker, TokenStore, TrayPresentation } from "../index.js";

/* ── windows ───────────────────────────────────────────────────────────── */

interface BaseWindowOptions {
  /** Directory holding the built HTML and the built preload. */
  rendererDir: string;
  page: string;
  preload?: string;
  /**
   * Turns off the preload sandbox. Named to be visible in a diff: a preload
   * that needs Node has work in it that belongs in the main process.
   */
  unsafeAllowNodeInPreload?: boolean;
}

export function createPanelWindow(
  options: BaseWindowOptions & {
    width?: number;
    height?: number;
    backgroundColor?: string;
    transparent?: boolean;
    hideOnBlur?: boolean;
  },
): import("electron").BrowserWindow;

export function createAppWindow(
  options: BaseWindowOptions & {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    backgroundColor?: string;
    titleBarStyle?: import("electron").BrowserWindowConstructorOptions["titleBarStyle"];
    closeToHide?: boolean;
  },
): import("electron").BrowserWindow;

export function createHiddenWindow(options: BaseWindowOptions): import("electron").BrowserWindow;

export function positionUnderTray(
  panel: import("electron").BrowserWindow,
  trayBounds: import("electron").Rectangle,
  options?: { gap?: number; margin?: number },
): void;

export function revealQuietly(window: import("electron").BrowserWindow): void;

/** Call from `before-quit`, or a close-to-hide window will not let the app exit. */
export function markQuitting(): void;
export function isQuitting(): boolean;

/* ── tray ──────────────────────────────────────────────────────────────── */

export function svgImage(svg: string, options?: { template?: boolean }): import("electron").NativeImage;

export function createTray(options: {
  icons: Record<string, () => import("electron").NativeImage>;
  onClick?: (bounds: import("electron").Rectangle) => void;
  menu?: () => import("electron").MenuItemConstructorOptions[];
  initialIcon?: string;
}): {
  render(presentation: Pick<TrayPresentation, "icon" | "title" | "tooltip">): void;
  bounds(): import("electron").Rectangle;
  destroy(): void;
  raw: import("electron").Tray;
};

/* ── bridge ────────────────────────────────────────────────────────────── */

export interface Bridge {
  name: string;
  channels: string[];
  commands: string[];
  /** Preload side. Freezes and exposes `window[name]`. */
  expose(): Record<string, (...args: any[]) => void>;
  /** Main side. One handler per declared command; extras and gaps both throw. */
  handle(handlers: Record<string, (...args: any[]) => void>): void;
  push(
    windows: readonly (import("electron").BrowserWindow | null | undefined)[],
    channel: string,
    payload: unknown,
  ): void;
  wire(kind: "push" | "cmd", key: string): string;
}

export function defineBridge(definition: {
  name: string;
  channels?: readonly string[];
  commands?: readonly string[];
}): Bridge;

/* ── stores ────────────────────────────────────────────────────────────── */

export function createJsonStore<Keys extends string>(
  dir: string,
  documents: Record<Keys, { file: string; normalize: (raw: unknown) => any }>,
): {
  dir: string;
  pathFor(key: Keys): string;
  read(key: Keys): Promise<any>;
  write(key: Keys, value: unknown): Promise<void>;
};

/** Throws on `write` when the OS offers no encrypted storage. Never falls back to a file. */
export function safeStorageTokenStore(options: { file: string }): TokenStore;

/* ── permissions ───────────────────────────────────────────────────────── */

export function electronPermissionBroker(): PermissionBroker;
export function openPermissionSettings(kind: string): Promise<boolean>;
