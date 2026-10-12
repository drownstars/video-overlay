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