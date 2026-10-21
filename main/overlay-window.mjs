import { app, BrowserWindow, globalShortcut, screen } from "electron";
import * as path from "node:path";
import {
  DISPLAY_NAME,
  PANEL_DEFAULT_HEIGHT,
  PANEL_DEFAULT_WIDTH,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  SAVE_DEBOUNCE_MS,
  WINDOW_MARGIN
} from "./constants.mjs";
import { setOverlayWindowGetter } from "./guest.mjs";
import { commit as commitHotkeys, isLowLevelAvailable, register as registerHotkey, unregister as unregisterHotkey } from "./hotkey.mjs";
import { getProgressMap, hasNoNextPart } from "./progress.mjs";
import { getVideoOverlayState, setVideoOverlayState, writeStateFile } from "./state.mjs";

const __dirname = import.meta.dirname;

let overlayWindowRef = null;
let saveTimer = null;
let creatingPromise = null;
let registeredAccelerators = [];

setOverlayWindowGetter(() => overlayWindowRef);

function getActiveWorkArea() {
  if (process.platform === "darwin") {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

export function saveOverlayState(reason, win) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const target = win ?? overlayWindowRef;
  if (!target || target.isDestroyed()) return;
  const { x, y, width, height } = target.getBounds();
  const state = getVideoOverlayState();
  state.bounds = { x, y, width, height };
  state.progresses = getProgressMap();
  writeStateFile(state);
  console.log(`[video-overlay] state saved reason=${reason} x=${x} y=${y} width=${width} height=${height}`);
}

function scheduleSaveState(win) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (win && !win.isDestroyed()) saveOverlayState("debounced", win);
  }, SAVE_DEBOUNCE_MS);
}

export function broadcastState() {
  const state = getVideoOverlayState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("video-overlay:state", state);
  }
}

export function showOverlayWindow() {
  const win = overlayWindowRef;
  if (!win || win.isDestroyed()) return;
  const wasVisible = getVideoOverlayState().visible;
  win.setOpacity(getVideoOverlayState().opacity);
  win.setAlwaysOnTop(true, "normal");
  setVideoOverlayState({ visible: true });
  if (!wasVisible) {
    broadcastState();
  }
  win.showInactive();
}

export function destroyOverlayWindow(win) {
  const target = win ?? overlayWindowRef;
  if (!target || target.isDestroyed()) return;
  saveOverlayState("destroy", target);
  setVideoOverlayState({ visible: false });
  broadcastState();
  target.destroy();
  app.quit();
}

export function executePlaybackCommand(command) {
  const win = overlayWindowRef;
  if (!win || win.isDestroyed()) { console.warn("[video-overlay] 无法发送播放指令: 窗口不存在"); return; }
  console.log(`[video-overlay] 发送播放指令: ${command}`);
  win.webContents.send("video-overlay:playback-command", command);
}

export function registerPlaybackShortcuts() {
  unregisterPlaybackShortcuts();
  const state = getVideoOverlayState();
  const useLL = isLowLevelAvailable();
  const seen = new Set();
  for (const [accel, cmd] of [
    [state.playPauseKey, "toggle_play"],
    [state.seekForwardKey, "seek_forward"],
    [state.seekBackwardKey, "seek_backward"]
  ]) {
    if (!accel || seen.has(accel)) continue;
    seen.add(accel);
    const cb = () => executePlaybackCommand(cmd);
    if (useLL) {
      registerHotkey(accel, cb);
    } else if (!globalShortcut.register(accel, cb)) {
      console.warn(`[video-overlay] failed to register shortcut: ${accel}`);
      continue;
    }
    registeredAccelerators.push(accel);
  }
  commitHotkeys();
}

export function unregisterPlaybackShortcuts() {
  const useLL = isLowLevelAvailable();
  for (const accel of registeredAccelerators) {
    useLL ? unregisterHotkey(accel) : globalShortcut.unregister(accel);
  }
  registeredAccelerators = [];
}

export function setOverlayBounds(x, y, width, height) {
  const win = overlayWindowRef;
  if (!win || win.isDestroyed()) return;
  win.setBounds({ x, y, width, height });
  scheduleSaveState(win);
}

export function getOverlayWindow() {
  return overlayWindowRef && !overlayWindowRef.isDestroyed() ? overlayWindowRef : null;
}

export async function ensureOverlayWindow() {
  if (overlayWindowRef && !overlayWindowRef.isDestroyed()) {
    return overlayWindowRef;
  }
  if (creatingPromise) {
    return creatingPromise;
  }
  creatingPromise = createOverlayWindow().finally(() => {
    creatingPromise = null;
  });
  return creatingPromise;
}

async function createOverlayWindow() {
  const state = getVideoOverlayState();
  if (state.rememberProgress && hasNoNextPart(state.url)) {
    setVideoOverlayState({ url: "" });
  }
  const workArea = getActiveWorkArea();
  const savedBounds = state.bounds;
  const width = Math.max(PANEL_MIN_WIDTH, savedBounds?.width ?? PANEL_DEFAULT_WIDTH);
  const height = Math.max(PANEL_MIN_HEIGHT, savedBounds?.height ?? PANEL_DEFAULT_HEIGHT);
  let x = savedBounds?.x ?? workArea.x + workArea.width - width - WINDOW_MARGIN;
  let y = savedBounds?.y ?? workArea.y + WINDOW_MARGIN;
  x = Math.max(workArea.x - width + 40, Math.min(x, workArea.x + workArea.width - 40));
  y = Math.max(workArea.y - 40, Math.min(y, workArea.y + workArea.height - 40));

  const window = new BrowserWindow({
    title: DISPLAY_NAME,
    x,
    y,
    width,
    height,
    minWidth: PANEL_MIN_WIDTH,
    minHeight: PANEL_MIN_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      backgroundThrottling: false,
      webviewTag: true
    }
  });

  overlayWindowRef = window;

  window.setOpacity(state.opacity);
  window.on("move", () => {
    scheduleSaveState(window);
  });
  window.on("resize", () => {
    scheduleSaveState(window);
  });
  window.on("show", () => {
    setVideoOverlayState({ visible: true });
    broadcastState();
  });
  window.on("hide", () => {
    setVideoOverlayState({ visible: false });
    broadcastState();
  });
  window.on("close", () => {
    saveOverlayState("close", window);
    setVideoOverlayState({ visible: false });
    broadcastState();
    app.quit();
  });
  window.on("closed", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    unregisterPlaybackShortcuts();
    overlayWindowRef = null;
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  registerPlaybackShortcuts();

  try {
    await window.loadFile(path.join(__dirname, "../renderer/index.html"), {
      hash: "/video-overlay"
    });
  } catch (err) {
    // 退出时加载可能被窗口销毁中断，属正常竞态，仅记录
    console.warn("[video-overlay] 覆盖窗口加载中断:", err?.message ?? err);
  }
  broadcastState();
  return window;
}
