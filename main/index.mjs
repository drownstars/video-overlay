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