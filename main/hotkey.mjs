/**
 * 键盘快捷键模块 v2
 *
 * 使用 PowerShell + C# P/Invoke 安装 WH_KEYBOARD_LL 钩子。
 * 钩子运行在独立进程中，拥有自己的消息循环，比 FFI 方案更可靠。
 * 非 Windows 平台回退到 Electron globalShortcut。
 */

import { globalShortcut } from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";

const IS_WINDOWS = process.platform === "win32";

let psProcess = null;
let shortcuts = new Map(); // accelerator -> callback
let useLowLevel = false;
let stdoutBuffer = "";

function getScriptPath() {
  const __dirname = import.meta.dirname;
  return path.join(__dirname, "../scripts/hotkey-helper.ps1");
}

function startHook() {
  if (!IS_WINDOWS) return;
  if (psProcess) return;

  const keys = [...shortcuts.keys()];
  if (keys.length === 0) return;

  const scriptPath = getScriptPath();
  console.log(`[video-overlay] 启动 PowerShell 钩子: ${keys.join(", ")}`);

  psProcess = spawn("powershell", [
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    ...keys,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  stdoutBuffer = "";

  psProcess.stdout.on("data", (data) => {
    stdoutBuffer += data.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("KEY:")) {
        const key = trimmed.substring(4);
        const cb = shortcuts.get(key);
        if (cb) {
          console.log(`[video-overlay] 快捷键触发: ${key}`);
          try { cb(); } catch (err) {
            console.warn("[video-overlay] 快捷键回调异常:", err);
          }
        }
      }
    }
  });

  psProcess.stderr.on("data", (data) => {
    for (const line of data.toString().split("\n")) {
      const trimmed = line.trim();
      if (trimmed) console.log("[video-overlay] PS:", trimmed);
    }
  });

  psProcess.on("close", (code) => {
    console.log(`[video-overlay] PowerShell 钩子退出 (code=${code})`);
    psProcess = null;
    // 自动重启
    if (shortcuts.size > 0) {
      console.log("[video-overlay] 尝试重启钩子...");
      setTimeout(() => startHook(), 1000);
    }
  });

  useLowLevel = true;
}

function stopHook() {
  if (psProcess) {
    psProcess.kill();
    psProcess = null;
  }
  useLowLevel = false;
}

// ============================================================
// 公开 API
// ============================================================

export function init() {
  // 模块初始化，延迟到首次 register 时启动钩子
}

export function isLowLevelAvailable() {
  return IS_WINDOWS;
}

export function register(accelerator, callback) {
  if (IS_WINDOWS) {
    shortcuts.set(accelerator, callback);
  } else {
    globalShortcut.register(accelerator, callback);
  }
}

/** 注册完成后调用，启动钩子 */
export function commit() {
  if (IS_WINDOWS && shortcuts.size > 0) {
    stopHook();
    startHook();
  }
}

export function unregister(accelerator) {
  shortcuts.delete(accelerator);
  if (IS_WINDOWS) {
    stopHook();
    if (shortcuts.size > 0) startHook();
  } else {
    globalShortcut.unregister(accelerator);
  }
}

export function unregisterAll() {
  shortcuts.clear();
  if (IS_WINDOWS) {
    stopHook();
  }
  globalShortcut.unregisterAll();
}