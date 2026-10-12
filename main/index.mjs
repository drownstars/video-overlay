import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell } from "electron";
import * as path from "node:path";
import { getVideoOverlayState, setVideoOverlayState, writeStateFile } from "./state.mjs";
import { clearNoNextPart, clearProgressEntries, getProgressMap, hasNoNextPart, pushUrlHistory } from "./progress.mjs";
import { attachGuest, setOverlayWindowGetter, startGuestPolling, stopGuestPolling } from "./guest.mjs";
import { init as initHotkey, register as registerHotkey, unregister as unregisterHotkey, unregisterAll as unregisterAllHotkeys, isLowLevelAvailable, commit as commitHotkeys } from "./hotkey.mjs";

const __filename = import.meta.filename;
const __dirname = import.meta.dirname;

const IS_WINDOWS = process.platform === "win32";
if (IS_WINDOWS) {
  app.setAppUserModelId("com.nikkigallery.video-overlay");
}

const displayName = "视频小窗";

const PANEL_DEFAULT_WIDTH = 520;
const PANEL_DEFAULT_HEIGHT = 320;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 180;
const MARGIN = 20;

const SAVE_DEBOUNCE_MS = 300;

function getActiveWorkArea() {
  if (process.platform === "darwin") {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  }
  return screen.getPrimaryDisplay().workArea;
}

let videoOverlayWindowRef = null;
let videoOverlaySaveTimer = null;
let creatingVideoOverlayWindowPromise = null;
let videoOverlayShortcutsRegistered = false;
let registeredAccelerators = [];

setOverlayWindowGetter(() => videoOverlayWindowRef);

function saveState(reason, win) {
  if (videoOverlaySaveTimer) {
    clearTimeout(videoOverlaySaveTimer);
    videoOverlaySaveTimer = null;
  }
  const target = win ?? videoOverlayWindowRef;
  if (!target || target.isDestroyed()) return;
  const { x, y, width, height } = target.getBounds();
  const state = getVideoOverlayState();
  state.bounds = { x, y, width, height };
  state.progresses = getProgressMap();
  writeStateFile(state);
  console.log(`[video-overlay] state saved reason=${reason} x=${x} y=${y} width=${width} height=${height}`);
}

function scheduleSaveState(win) {
  if (videoOverlaySaveTimer) clearTimeout(videoOverlaySaveTimer);
  videoOverlaySaveTimer = setTimeout(() => {
    videoOverlaySaveTimer = null;
    if (win && !win.isDestroyed()) saveState("debounced", win);
  }, SAVE_DEBOUNCE_MS);
}

function broadcastState() {
  const state = getVideoOverlayState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send("video-overlay:state", state);
  }
}

function showVideoOverlayWindow() {
  const win = videoOverlayWindowRef;
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

function destroyVideoOverlayWindow(win) {
  const target = win ?? videoOverlayWindowRef;
  if (!target || target.isDestroyed()) return;
  saveState("destroy", target);
  setVideoOverlayState({ visible: false });
  broadcastState();
  target.destroy();
}

function executePlaybackCommand(command) {
  const win = videoOverlayWindowRef;
  if (!win || win.isDestroyed()) { console.warn("[video-overlay] 无法发送播放指令: 窗口不存在"); return; }
  console.log(`[video-overlay] 发送播放指令: ${command}`);
  win.webContents.send("video-overlay:playback-command", command);
}

function registerPlaybackShortcuts() {
  unregisterVideoOverlayShortcuts();
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
  videoOverlayShortcutsRegistered = true;
  commitHotkeys();
}

function unregisterVideoOverlayShortcuts() {
  const useLL = isLowLevelAvailable();
  for (const accel of registeredAccelerators) {
    useLL ? unregisterHotkey(accel) : globalShortcut.unregister(accel);
  }
  registeredAccelerators = [];
  videoOverlayShortcutsRegistered = false;
}

function registerVideoOverlayIpc() {
  ipcMain.handle("video-overlay:get-bounds", () => {
    const win = videoOverlayWindowRef;
    if (!win || win.isDestroyed()) {
      return { x: 0, y: 0, width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT };
    }
    return win.getBounds();
  });

  ipcMain.handle("video-overlay:set-ignore-mouse-events", (_event, ignore, options) => {
    const win = videoOverlayWindowRef;
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(ignore, options);
  });

  ipcMain.handle("video-overlay:set-bounds", (_event, x, y, width, height) => {
    const win = videoOverlayWindowRef;
    if (!win || win.isDestroyed()) return;
    win.setBounds({ x, y, width, height });
    scheduleSaveState(win);
  });

  ipcMain.handle("video-overlay:show", async () => {
    const win = await ensureVideoOverlayWindow();
    showVideoOverlayWindow();
    return Boolean(win && !win.isDestroyed());
  });

  ipcMain.handle("video-overlay:hide", () => {
    destroyVideoOverlayWindow();
  });

  ipcMain.handle("video-overlay:get-state", () => {
    return getVideoOverlayState();
  });

  ipcMain.handle("video-overlay:set-state", (_event, patch) => {
    const win = videoOverlayWindowRef;
    const next = setVideoOverlayState(patch);
    if (typeof patch.rememberProgress === "boolean") {
      if (next.rememberProgress) startGuestPolling();
      else stopGuestPolling();
    }
    if (win && !win.isDestroyed()) {
      win.setOpacity(next.opacity);
      if (typeof patch.visible === "boolean") {
        if (patch.visible) showVideoOverlayWindow();
        else destroyVideoOverlayWindow(win);
      }
    }
    if (win && !win.isDestroyed()) {
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
    const win = videoOverlayWindowRef;
    if (win && !win.isDestroyed()) {
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
    const win = videoOverlayWindowRef;
    if (!win || win.isDestroyed()) return;
    win.focus();
    win.webContents.send("video-overlay:focus-input");
  });

  ipcMain.on("launcher:open-external", (_event, url) => {
    if (url && typeof url === "string") {
      shell.openExternal(url);
    }
  });
}

async function ensureVideoOverlayWindow() {
  if (videoOverlayWindowRef && !videoOverlayWindowRef.isDestroyed()) {
    return videoOverlayWindowRef;
  }
  if (creatingVideoOverlayWindowPromise) {
    return creatingVideoOverlayWindowPromise;
  }
  creatingVideoOverlayWindowPromise = createVideoOverlayWindow().finally(() => {
    creatingVideoOverlayWindowPromise = null;
  });
  return creatingVideoOverlayWindowPromise;
}

async function createVideoOverlayWindow() {
  const state = getVideoOverlayState();
  if (state.rememberProgress && hasNoNextPart(state.url)) {
    setVideoOverlayState({ url: "" });
  }
  const workArea = getActiveWorkArea();
  const savedBounds = state.bounds;
  const width = Math.max(PANEL_MIN_WIDTH, savedBounds?.width ?? PANEL_DEFAULT_WIDTH);
  const height = Math.max(PANEL_MIN_HEIGHT, savedBounds?.height ?? PANEL_DEFAULT_HEIGHT);
  let x = savedBounds?.x ?? workArea.x + workArea.width - width - MARGIN;
  let y = savedBounds?.y ?? workArea.y + MARGIN;
  x = Math.max(workArea.x - width + 40, Math.min(x, workArea.x + workArea.width - 40));
  y = Math.max(workArea.y - 40, Math.min(y, workArea.y + workArea.height - 40));

  const window = new BrowserWindow({
    title: displayName,
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

  videoOverlayWindowRef = window;

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
  window.on("close", (event) => {
    event.preventDefault();
    destroyVideoOverlayWindow(window);
  });
  window.on("closed", () => {
    if (videoOverlaySaveTimer) {
      clearTimeout(videoOverlaySaveTimer);
      videoOverlaySaveTimer = null;
    }
    unregisterVideoOverlayShortcuts();
    videoOverlayWindowRef = null;
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  registerPlaybackShortcuts();

  await window.loadFile(path.join(__dirname, "../renderer/index.html"), {
    hash: "/video-overlay"
  });
  broadcastState();
  return window;
}

let tray = null;
let settingsWindowRef = null;

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "../resources/icon.ico"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(displayName);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示视频小窗",
        click: () => {
          void ensureVideoOverlayWindow().then(() => showVideoOverlayWindow());
        }
      },
      {
        label: "设置",
        click: () => showSettingsWindow()
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => app.quit()
      }
    ])
  );
  tray.on("click", () => {
    void ensureVideoOverlayWindow().then(() => showVideoOverlayWindow());
  });
  tray.on("double-click", () => {
    void ensureVideoOverlayWindow().then(() => showVideoOverlayWindow());
  });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function showSettingsWindow() {
  if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
    settingsWindowRef.show();
    settingsWindowRef.focus();
    return;
  }
  const window = new BrowserWindow({
    title: `${displayName} - 设置`,
    width: 460,
    height: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js")
    }
  });
  settingsWindowRef = window;
  window.on("ready-to-show", () => {
    window.show();
  });
  window.on("closed", () => {
    settingsWindowRef = null;
  });
  void window.loadFile(path.join(__dirname, "../settings/index.html"));
}

app.requestSingleInstanceLock()
  ? (() => {
      app.on("second-instance", () => {
        void ensureVideoOverlayWindow().then(() => showVideoOverlayWindow());
      });

      app.whenReady().then(async () => {
        await initHotkey();
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

        registerVideoOverlayIpc();
        createTray();

        app.on("web-contents-created", (event, wc) => {
          if (wc.getType() === "webview") {
            attachGuest(wc);
          }
        });

        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            void ensureVideoOverlayWindow().then(() => showVideoOverlayWindow());
          }
        });

        app.on("window-all-closed", () => {
          // keep alive in tray; quit only via tray menu
        });

        if (process.argv.includes("--open-settings")) {
          showSettingsWindow();
        }

        void ensureVideoOverlayWindow().then(() => {
          showVideoOverlayWindow();
        });
      });

      app.on("before-quit", () => {
        saveState("before-quit");
        unregisterVideoOverlayShortcuts();
        unregisterAllHotkeys();
        destroyTray();
      });
    })()
  : app.quit();
