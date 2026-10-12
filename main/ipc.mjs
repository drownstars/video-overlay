import { BrowserWindow, ipcMain, shell } from "electron";
import { PANEL_DEFAULT_HEIGHT, PANEL_DEFAULT_WIDTH } from "./constants.mjs";
import { startGuestPolling, stopGuestPolling } from "./guest.mjs";
import {
  broadcastState,
  destroyOverlayWindow,
  ensureOverlayWindow,
  executePlaybackCommand,
  getOverlayWindow,
  registerPlaybackShortcuts,
  setOverlayBounds,
  showOverlayWindow
} from "./overlay-window.mjs";
import { clearNoNextPart, clearProgressEntries, getProgressMap, pushUrlHistory } from "./progress.mjs";
import { getVideoOverlayState, setVideoOverlayState } from "./state.mjs";

export function registerIpc() {
  // ---- 通用窗口控制 ----
  ipcMain.handle("window:minimize", () => {
    BrowserWindow.getFocusedWindow()?.minimize();
  });
  ipcMain.handle("window:toggle-maximize", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return false;
    if (win.isMaximized()) {
      win.unmaximize();
      return false;
    }
    win.maximize();
    return true;
  });
  ipcMain.handle("window:close", () => {
    BrowserWindow.getFocusedWindow()?.close();
  });

  // ---- 外部链接 ----
  ipcMain.on("launcher:open-external", (_event, url) => {
    if (url && typeof url === "string") {
      shell.openExternal(url);
    }
  });

  // ---- 视频小窗 ----
  ipcMain.handle("video-overlay:get-bounds", () => {
    const win = getOverlayWindow();
    if (!win) {
      return { x: 0, y: 0, width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT };
    }
    return win.getBounds();
  });

  ipcMain.handle("video-overlay:set-ignore-mouse-events", (_event, ignore, options) => {
    const win = getOverlayWindow();
    if (win) win.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.handle("video-overlay:set-bounds", (_event, x, y, width, height) => {
    setOverlayBounds(x, y, width, height);
  });

  ipcMain.handle("video-overlay:show", async () => {
    const win = await ensureOverlayWindow();
    showOverlayWindow();
    return Boolean(win && !win.isDestroyed());
  });

  ipcMain.handle("video-overlay:hide", () => {
    destroyOverlayWindow();
  });

  ipcMain.handle("video-overlay:get-state", () => {
    return getVideoOverlayState();
  });

  ipcMain.handle("video-overlay:set-state", (_event, patch) => {
    const win = getOverlayWindow();
    const next = setVideoOverlayState(patch);
    if (typeof patch.rememberProgress === "boolean") {
      if (next.rememberProgress) startGuestPolling();
      else stopGuestPolling();
    }
    if (win) {
      win.setOpacity(next.opacity);
      if (typeof patch.visible === "boolean") {
        if (patch.visible) showOverlayWindow();
        else destroyOverlayWindow(win);
      }
    }
    if (win) {
      registerPlaybackShortcuts();
    }
    broadcastState();
    return getVideoOverlayState();
  });

  ipcMain.handle("video-overlay:navigate", (_event, url) => {
    clearNoNextPart(url);
    const next = setVideoOverlayState({ url });
    if (next.url) {
      pushUrlHistory(next.url);
    }
    const win = getOverlayWindow();
    if (win) {
      win.webContents.send("video-overlay:navigate", next.url);
    }
    broadcastState();
    return next;
  });

  ipcMain.handle("video-overlay:clear-progress", () => {
    clearProgressEntries();
    return getProgressMap();
  });

  ipcMain.handle("video-overlay:execute-playback-command", (_event, command) => {
    executePlaybackCommand(command);
  });

  ipcMain.handle("video-overlay:focus-input", () => {
    const win = getOverlayWindow();
    if (!win) return;
    win.focus();
    win.webContents.send("video-overlay:focus-input");
  });
}