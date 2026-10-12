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