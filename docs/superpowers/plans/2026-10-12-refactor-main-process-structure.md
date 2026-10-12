# 主进程结构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 god-object 式的 `main/index.mjs`（约 700 行）拆分为单一职责模块，为状态添加内存缓存，消除硬编码路径，补齐 README 与项目元数据，且功能行为零变化。

**Architecture:** 主进程按职责拆分为 `constants / state / progress / guest / hotkey / overlay-window / settings-window / tray / ipc / index(入口)`。所有 `ipcMain` 通道名、preload API、状态文件格式保持不变；`state.mjs` 增加内存缓存，`readStateFile/writeStateFile` 读写缓存并同步磁盘，消除重复磁盘 IO。

**Tech Stack:** Electron 37 (ESM, `.mjs`), Node 22, PowerShell 低层键盘钩子。

## Global Constraints

- 不改动 `preload/index.js`、`renderer/`（预构建产物）、`settings/app.js`、`main/guest.mjs`、`main/progress.mjs`、`main/hotkey.mjs`、`scripts/hotkey-helper.*`
- IPC 通道名（`video-overlay:*`、`window:*`、`launcher:open-external`）与返回值必须与现状完全一致
- 状态文件 `video-overlay-state.json` 的字段结构不变；`progresses` 字段仅随 `writeStateFile` 整体写回
- 依赖关系必须无环：state ← progress ← guest；state ← overlay-window ← (tray, ipc)；settings-window ← tray；index 只做装配
- Windows 平台行为与现状一致（`setAppUserModelId`、`runas` 启动、PowerShell 钩子）
- 每个 commit 后应用必须可启动（用 `node --check` + 冒烟测试验证）

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `main/constants.mjs` | 共享常量（窗口尺寸、名称、app id、防抖时间） | 新建 |
| `main/state.mjs` | 状态持久化 + 内存缓存 | 重写 |
| `main/overlay-window.mjs` | 覆盖小窗生命周期、边界保存、播放快捷键、状态广播 | 新建（从 index 迁出） |
| `main/settings-window.mjs` | 设置窗口 | 新建（从 index 迁出） |
| `main/tray.mjs` | 托盘 | 新建（从 index 迁出） |
| `main/ipc.mjs` | 全部 ipcMain handler 注册 | 新建（从 index 迁出） |
| `main/index.mjs` | 入口：app 生命周期、单实例锁、模块装配、冒烟钩子 | 重写 |
| `start.bat` / `start-admin.vbs` | 用相对路径定位自身目录 | 重写 |
| `.gitignore` | 忽略生成物 `start.vbs` | 修改 |
| `README.md` | 项目说明与结构文档 | 新建 |
| `package.json` | 补 repository/private 元数据 | 修改 |
| `docs/superpowers/plans/2026-10-12-refactor-main-process-structure.md` | 本计划 | 新建 |

---

### Task 1: 常量模块 + 状态内存缓存

**Files:**
- Create: `main/constants.mjs`
- Rewrite: `main/state.mjs`

**Interfaces:**
- Produces: `constants.mjs` 导出 `APP_ID, DISPLAY_NAME, PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_HEIGHT, PANEL_MIN_WIDTH, PANEL_MIN_HEIGHT, WINDOW_MARGIN, SAVE_DEBOUNCE_MS, SETTINGS_WIDTH, SETTINGS_HEIGHT`
- Produces: `state.mjs` 导出签名与现状完全一致：`DEFAULT_STATE, MAX_URL_HISTORY, normalizeUrlHistory, readStateFile, writeStateFile, getVideoOverlayState, setVideoOverlayState`

- [ ] **Step 1: 创建 `main/constants.mjs`**

```js
export const APP_ID = "com.nikkigallery.video-overlay";
export const DISPLAY_NAME = "视频小窗";

export const PANEL_DEFAULT_WIDTH = 520;
export const PANEL_DEFAULT_HEIGHT = 320;
export const PANEL_MIN_WIDTH = 320;
export const PANEL_MIN_HEIGHT = 180;
export const WINDOW_MARGIN = 20;

export const SAVE_DEBOUNCE_MS = 300;

export const SETTINGS_WIDTH = 460;
export const SETTINGS_HEIGHT = 560;
```

- [ ] **Step 2: 重写 `main/state.mjs`（增加内存缓存，外部行为不变）**

```js
import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_STATE = {
  visible: false,
  url: "",
  opacity: 1,
  playPauseKey: "f8",
  seekForwardKey: "f9",
  seekBackwardKey: "f7",
  rememberProgress: true
};

export const MAX_URL_HISTORY = 20;

// 内存缓存：进程内所有读写先走缓存，避免每次调用都同步读盘
let cachedRawState = null;
let cacheInitialized = false;

function getStateFilePath() {
  return path.join(app.getPath("userData"), "video-overlay-state.json");
}

function normalizeKey(value, fallback) {
  if (typeof value !== "string") return fallback;
  const next = value.trim().toLowerCase();
  return next || fallback;
}

function normalizeOpacity(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0.2, value));
}

function normalizeBounds(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function normalizeUrlHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && /^https?:\/\//i.test(item)).slice(0, MAX_URL_HISTORY);
}

function loadCachedRaw() {
  if (cacheInitialized) return cachedRawState;
  cacheInitialized = true;
  try {
    const raw = fs.readFileSync(getStateFilePath(), "utf8");
    const value = JSON.parse(raw);
    cachedRawState = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    cachedRawState = null;
  }
  return cachedRawState;
}

export function readStateFile() {
  return loadCachedRaw();
}

export function writeStateFile(state) {
  cachedRawState = state;
  cacheInitialized = true;
  try {
    fs.writeFileSync(getStateFilePath(), JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("[video-overlay] 保存状态失败:", err);
  }
}

export function getVideoOverlayState() {
  const value = readStateFile();
  if (!value) {
    return { ...DEFAULT_STATE, bounds: null, urlHistory: [] };
  }
  return {
    visible: Boolean(value.visible),
    url: typeof value.url === "string" ? value.url.trim() : DEFAULT_STATE.url,
    opacity: normalizeOpacity(value.opacity, DEFAULT_STATE.opacity),
    playPauseKey: normalizeKey(value.playPauseKey, DEFAULT_STATE.playPauseKey),
    seekForwardKey: normalizeKey(value.seekForwardKey, DEFAULT_STATE.seekForwardKey),
    seekBackwardKey: normalizeKey(value.seekBackwardKey, DEFAULT_STATE.seekBackwardKey),
    rememberProgress: value.rememberProgress !== false,
    bounds: normalizeBounds(value.bounds),
    urlHistory: normalizeUrlHistory(value.urlHistory)
  };
}

function pick(patchVal, prevVal, fallback, normalize) {
  return patchVal === undefined ? normalize(prevVal, fallback) : normalize(patchVal, prevVal);
}

export function setVideoOverlayState(patch) {
  const prev = readStateFile() ?? {};
  const next = {
    visible: typeof patch.visible === "boolean" ? patch.visible : Boolean(prev.visible),
    url: typeof patch.url === "string" ? patch.url.trim() : (typeof prev.url === "string" ? prev.url.trim() : DEFAULT_STATE.url),
    opacity: pick(patch.opacity, prev.opacity, DEFAULT_STATE.opacity, normalizeOpacity),
    playPauseKey: pick(patch.playPauseKey, prev.playPauseKey, DEFAULT_STATE.playPauseKey, normalizeKey),
    seekForwardKey: pick(patch.seekForwardKey, prev.seekForwardKey, DEFAULT_STATE.seekForwardKey, normalizeKey),
    seekBackwardKey: pick(patch.seekBackwardKey, prev.seekBackwardKey, DEFAULT_STATE.seekBackwardKey, normalizeKey),
    rememberProgress: typeof patch.rememberProgress === "boolean" ? patch.rememberProgress : prev.rememberProgress !== false,
    bounds: pick(patch.bounds, prev.bounds, null, normalizeBounds),
    progresses: prev.progresses && typeof prev.progresses === "object" && !Array.isArray(prev.progresses) ? prev.progresses : {},
    urlHistory: normalizeUrlHistory(prev.urlHistory)
  };
  writeStateFile(next);
  return next;
}
```

*注：`progress.mjs` / `guest.mjs` 通过 `readStateFile()/writeStateFile()` 读写整体状态（含 `progresses`），缓存版两者同步，语义与原来"每次读盘"一致。*

- [ ] **Step 3: 语法校验**

Run: `node --check main/constants.mjs && node --check main/state.mjs`
Expected: 无输出、退出码 0

- [ ] **Step 4: Commit**

```bash
git add main/constants.mjs main/state.mjs docs/superpowers/plans/2026-10-12-refactor-main-process-structure.md
git commit -m "refactor(main): extract constants module and cache state in memory"
```

---

### Task 2: 覆盖小窗模块

**Files:**
- Create: `main/overlay-window.mjs`

**Interfaces:**
- Consumes: `constants.mjs`、`guest.mjs(setOverlayWindowGetter)`、`hotkey.mjs(register/unregister/isLowLevelAvailable/commit)`、`progress.mjs(getProgressMap, hasNoNextPart)`、`state.mjs`
- Produces: `getOverlayWindow() -> BrowserWindow|null`、`ensureOverlayWindow() -> Promise<BrowserWindow|null>`、`showOverlayWindow()`、`destroyOverlayWindow(win?)`、`broadcastState()`、`saveOverlayState(reason, win?)`、`setOverlayBounds(x,y,width,height)`、`registerPlaybackShortcuts()`、`unregisterPlaybackShortcuts()`、`executePlaybackCommand(command)`

- [ ] **Step 1: 创建 `main/overlay-window.mjs`（逻辑逐行照搬自原 index.mjs；删除死代码 `videoOverlayShortcutsRegistered`）**

```js
import { BrowserWindow, globalShortcut, screen } from "electron";
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
  window.on("close", (event) => {
    event.preventDefault();
    destroyOverlayWindow(window);
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

  await window.loadFile(path.join(__dirname, "../renderer/index.html"), {
    hash: "/video-overlay"
  });
  broadcastState();
  return window;
}
```

- [ ] **Step 2: 语法校验**

Run: `node --check main/overlay-window.mjs`
Expected: 无输出、退出码 0

---

### Task 3: 设置窗口 + 托盘模块

**Files:**
- Create: `main/settings-window.mjs`
- Create: `main/tray.mjs`

**Interfaces:**
- Produces: `settings-window.mjs: showSettingsWindow()`
- Consumes/Produces: `tray.mjs: createTray(), destroyTray()`（内部依赖 overlay-window/settings-window，无环）

- [ ] **Step 1: 创建 `main/settings-window.mjs`**

```js
import { BrowserWindow } from "electron";
import * as path from "node:path";
import { DISPLAY_NAME, SETTINGS_HEIGHT, SETTINGS_WIDTH } from "./constants.mjs";

const __dirname = import.meta.dirname;

let settingsWindowRef = null;

export function showSettingsWindow() {
  if (settingsWindowRef && !settingsWindowRef.isDestroyed()) {
    settingsWindowRef.show();
    settingsWindowRef.focus();
    return;
  }
  const window = new BrowserWindow({
    title: `${DISPLAY_NAME} - 设置`,
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
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
```

- [ ] **Step 2: 创建 `main/tray.mjs`**

```js
import { app, Menu, nativeImage, Tray } from "electron";
import * as path from "node:path";
import { DISPLAY_NAME } from "./constants.mjs";
import { ensureOverlayWindow, showOverlayWindow } from "./overlay-window.mjs";
import { showSettingsWindow } from "./settings-window.mjs";

const __dirname = import.meta.dirname;

let tray = null;

export function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "../resources/icon.ico"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip(DISPLAY_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示视频小窗",
        click: () => {
          void ensureOverlayWindow().then(() => showOverlayWindow());
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
    void ensureOverlayWindow().then(() => showOverlayWindow());
  });
  tray.on("double-click", () => {
    void ensureOverlayWindow().then(() => showOverlayWindow());
  });
}

export function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
```

- [ ] **Step 3: 语法校验**

Run: `node --check main/settings-window.mjs && node --check main/tray.mjs`
Expected: 无输出、退出码 0

---

### Task 4: IPC 模块

**Files:**
- Create: `main/ipc.mjs`

**Interfaces:**
- Consumes: `overlay-window.mjs` 全部导出、`guest.mjs(startGuestPolling, stopGuestPolling)`、`progress.mjs(clearNoNextPart, clearProgressEntries, getProgressMap, pushUrlHistory)`、`state.mjs`、`constants.mjs`
- Produces: `registerIpc()`，注册全部 `ipcMain` handler（通道与现状一致）

- [ ] **Step 1: 创建 `main/ipc.mjs`**

```js
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
```

- [ ] **Step 2: 语法校验**

Run: `node --check main/ipc.mjs`
Expected: 无输出、退出码 0

---

### Task 5: 入口重写 + 冒烟钩子

**Files:**
- Rewrite: `main/index.mjs`

**Interfaces:**
- Consumes: 全部新模块
- Produces: app 装配（唯一入口）；`VIDEO_OVERLAY_SMOKE_TEST=1` 时启动就绪 3 秒后自动退出

- [ ] **Step 1: 重写 `main/index.mjs`**

```js
import { app, BrowserWindow } from "electron";
import { APP_ID } from "./constants.mjs";
import { attachGuest } from "./guest.mjs";
import { init as initHotkey, unregisterAll as unregisterAllHotkeys } from "./hotkey.mjs";
import { registerIpc } from "./ipc.mjs";
import {
  ensureOverlayWindow,
  saveOverlayState,
  showOverlayWindow,
  unregisterPlaybackShortcuts
} from "./overlay-window.mjs";
import { showSettingsWindow } from "./settings-window.mjs";
import { createTray, destroyTray } from "./tray.mjs";

const IS_WINDOWS = process.platform === "win32";
if (IS_WINDOWS) {
  app.setAppUserModelId(APP_ID);
}

app.requestSingleInstanceLock()
  ? (() => {
      app.on("second-instance", () => {
        void ensureOverlayWindow().then(() => showOverlayWindow());
      });

      app.whenReady().then(async () => {
        await initHotkey();
        registerIpc();
        createTray();

        app.on("web-contents-created", (event, wc) => {
          if (wc.getType() === "webview") {
            attachGuest(wc);
          }
        });

        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            void ensureOverlayWindow().then(() => showOverlayWindow());
          }
        });

        app.on("window-all-closed", () => {
          // 常驻托盘，仅通过托盘菜单退出
        });

        if (process.argv.includes("--open-settings")) {
          showSettingsWindow();
        }

        void ensureOverlayWindow().then(() => {
          showOverlayWindow();
        });

        // 冒烟测试钩子：VIDEO_OVERLAY_SMOKE_TEST=1 npx electron .
        if (process.env.VIDEO_OVERLAY_SMOKE_TEST === "1") {
          console.log("[video-overlay] smoke test: boot OK, quitting in 3s");
          setTimeout(() => app.quit(), 3000);
        }
      });

      app.on("before-quit", () => {
        saveOverlayState("before-quit");
        unregisterPlaybackShortcuts();
        unregisterAllHotkeys();
        destroyTray();
      });
    })()
  : app.quit();
```

- [ ] **Step 2: 语法校验**

Run: `node --check main/index.mjs`
Expected: 无输出、退出码 0

- [ ] **Step 3: 冒烟测试（验证模块装配、IPC 注册、窗口创建、状态读写、快捷键钩子）**

Run:
```bash
VIDEO_OVERLAY_SMOKE_TEST=1 npx electron . > /tmp/smoke-refactor.log 2>&1; echo "exit=$?"; tail -40 /tmp/smoke-refactor.log
```
Expected: `exit=0`；日志含 `smoke test: boot OK`；无 `Error:` / `Cannot find module` / `JavaScript error`；状态文件 `%APPDATA%\video-overlay\video-overlay-state.json` 已创建

- [ ] **Step 4: Commit**

```bash
git add main/
git commit -m "refactor(main): split god-object entry into focused modules"
```

---

### Task 6: 启动脚本可移植化 + 忽略生成物

**Files:**
- Rewrite: `start.bat`
- Rewrite: `start-admin.vbs`
- Modify: `.gitignore`
- Action: `git rm --cached start.vbs`（由 create-shortcut.ps1 动态生成，含本机绝对路径）

- [ ] **Step 1: 重写 `start.bat`（用 `%~dp0` 定位自身目录）**

```bat
@echo off
cd /d "%~dp0"
npx electron .
```

- [ ] **Step 2: 重写 `start-admin.vbs`（用 fso 定位自身目录）**

```vbs
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute appDir & "\start.bat", "", "", "runas", 1
```

- [ ] **Step 3: `.gitignore` 增加 `start.vbs` 并移出跟踪**

`.gitignore` 追加内容：
```
# Generated by scripts/create-shortcut.ps1 (contains machine-specific paths)
start.vbs
```

Run: `git rm --cached start.vbs`
Expected: 文件从暂存区移除，磁盘文件保留

---

### Task 7: README + 项目元数据

**Files:**
- Create: `README.md`
- Modify: `package.json`

- [ ] **Step 1: 创建 `README.md`**（中文，涵盖：简介、功能、目录结构、运行方式、快捷键设置、进度记忆机制、PowerShell 钩子说明、开发/冒烟测试命令）

- [ ] **Step 2: `package.json` 补充元数据**（增加 `repository` 与 `private`，其余字段不动）

```json
{
  "name": "video-overlay",
  "version": "1.0.0",
  "description": "奇想盒 - 视频小窗（独立版）",
  "private": true,
  "repository": {
    "type": "git",
    "url": "https://github.com/drownstars/video-overlay.git"
  },
  "main": "main/index.mjs",
  "author": {
    "name": "nikkigallery"
  },
  "scripts": {
    "start": "electron .",
    "create-shortcut": "powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1"
  },
  "devDependencies": {
    "electron": "^37.2.0"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: portable launch scripts, ignore generated start.vbs, add README"
```

---

### Task 8: 最终验证与推送

- [ ] **Step 1: 全量校验**

Run:
```bash
for f in main/*.mjs preload/index.js settings/app.js; do node --check "$f" || echo "FAIL $f"; done
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package.json OK')"
```
Expected: 全部通过，无 FAIL

- [ ] **Step 2: 最终冒烟测试**

Run:
```bash
VIDEO_OVERLAY_SMOKE_TEST=1 npx electron . > /tmp/smoke-final.log 2>&1; echo "exit=$?"; rg -i "boot OK|error|cannot find" /tmp/smoke-final.log | head -20
```
Expected: `exit=0`，含 `boot OK`，无 error

- [ ] **Step 3: 推送**

```bash
git push origin main
```

## Self-Review

**1. Spec coverage:**
- ✅ 拆分 index.mjs → Tasks 2-5
- ✅ 状态缓存 → Task 1
- ✅ 硬编码路径 → Task 6
- ✅ README/元数据 → Task 7
- ✅ 死代码移除 → Task 2（`shortcutsRegistered`）
- ✅ 验证 → Tasks 1-5 各步 + Task 8

**2. Placeholder scan:** 全部步骤含完整代码与精确命令，无 TBD。

**3. Type consistency:**
- `getOverlayWindow()` 在 ipc.mjs（5 处调用）与 overlay-window.mjs 定义一致，均返回 `BrowserWindow|null`
- `saveOverlayState(reason, win?)` 由 index.mjs `before-quit` 调用；`destroyOverlayWindow(win?)` 由 ipc.mjs 与窗口 `close` 事件调用，签名一致
- state.mjs 导出与 progress.mjs/guest.mjs 需求逐一核对一致