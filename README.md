# 视频小窗（video-overlay）

奇想盒 - 视频小窗（独立版）。基于 Electron 的全局悬浮小窗，可在任意应用之上悬浮播放 B 站视频，支持全局快捷键控制播放与分 P 断点续播。

## 功能

- 🪟 **置顶小窗**：无边框透明窗口，可拖动、缩放，始终悬浮于其他窗口之上
- 🎮 **全局快捷键**：播放/暂停、快进、快退（默认 `F8` / `F9` / `F7`），小窗不在前台也可控制视频
- ⏱ **断点续播**：自动记忆每个视频的分 P 与播放时间，再次打开自动恢复，接近片尾自动从头开始
- 📜 **无下一集标识**：命中"已无下一集"的视频不再自动续播
- 📌 **常驻托盘**：关闭小窗后程序驻留系统托盘，可随时唤出或打开设置
- ⌨️ **可自定义快捷键**：设置窗口中支持录制组合键（含修饰键与鼠标按键）
- 💾 **状态记忆**：窗口位置、大小、透明度、URL 历史均持久化到用户数据目录

## 目录结构

```
video-overlay/
├── main/                      # Electron 主进程（ESM）
│   ├── index.mjs              # 入口：app 生命周期、单实例锁、模块装配
│   ├── constants.mjs          # 共享常量（窗口尺寸、名称、app id）
│   ├── state.mjs              # 状态持久化 + 内存缓存（单文件状态）
│   ├── progress.mjs           # 播放进度记录 / 恢复判定 / B 站 URL 解析
│   ├── guest.mjs              # webview 访客：进度轮询、断点恢复注入
│   ├── hotkey.mjs             # 全局快捷键（Windows 低层钩子 / 回退 globalShortcut）
│   ├── overlay-window.mjs     # 覆盖小窗：创建/显示/销毁、边界保存、播放快捷键
│   ├── settings-window.mjs    # 设置窗口
│   ├── tray.mjs               # 系统托盘
│   └── ipc.mjs                # 全部 ipcMain 通道注册
├── preload/index.js           # contextBridge 暴露 window.App API
├── renderer/                  # 小窗页面（预构建产物，源码不在此仓库）
├── settings/                  # 设置页面（原生 HTML/JS/CSS）
├── scripts/
│   ├── create-shortcut.ps1    # 生成桌面快捷方式 + start.vbs（含管理员提权）
│   ├── create-shortcut.bat    # 同上（bat 版）
│   └── hotkey-helper.ps1      # C# P/Invoke 低层键盘钩子宿主
├── resources/icon.ico         # 托盘 / 快捷方式图标
├── start.bat                  # 直接启动
├── start-admin.vbs            # 以管理员身份启动（引用 start.bat）
└── docs/superpowers/plans/    # 实现计划存档
```

### 主进程模块依赖（无环）

```
index.mjs ──► overlay-window.mjs ──► (guest / hotkey / progress / state)
    │  └──► ipc.mjs ──► (overlay-window / guest / progress / state)
    └──► tray.mjs ──► (overlay-window / settings-window)
    └──► settings-window.mjs
state.mjs ◄── progress.mjs ◄── guest.mjs
```

## 运行

```bash
npm install        # 安装依赖（仅需一次）
npm start          # 启动
```

或者：

- `start.bat` — 当前目录启动
- `start-admin.vbs` — 管理员权限启动
- `npm run create-shortcut` — 在桌面创建"视频小窗"快捷方式（自动生成 `start.vbs`，其中包含本机绝对路径，故未纳入版本控制）

## 快捷键

| 功能 | 默认键 | 设置方式 |
|---|---|---|
| 播放 / 暂停 | `F8` | 设置窗口 → 点击按键按钮录制 |
| 快进 | `F9` | 同上 |
| 快退 | `F7` | 同上 |

支持组合键（`Ctrl` / `Alt` / `Shift` / `Win`）与功能键，Windows 上通过 `scripts/hotkey-helper.ps1` 安装 `WH_KEYBOARD_LL` 钩子实现全局响应；其他平台回退到 Electron `globalShortcut`。

## 进度记忆机制

- 每 5 秒轮询 webview 内 `<video>` 的播放状态，写入 `video-overlay-state.json` 的 `progresses` 字段
- 每个 B 站视频按 `BV号` 记录 `{ url, part, time, duration, updatedAt }`，最多保留 30 条
- 恢复时若命中"已无下一集"（`noNextPart`）则不再续播
- 设置窗口中可一键清除全部进度记录

## 开发

```bash
# 冒烟测试：启动 → 就绪 → 3 秒后自动退出（验证模块装配 / IPC / 窗口 / 状态 / 快捷键钩子）
VIDEO_OVERLAY_SMOKE_TEST=1 npx electron .
```

状态文件位置：`%APPDATA%\video-overlay\video-overlay-state.json`

## 技术栈

- Electron 37（主进程 ESM `.mjs`，Node 22）
- 渲染层：小窗为预构建 React 产物（本仓库不含源码），设置页为原生 HTML/JS
- 低层键盘钩子：PowerShell + C# P/Invoke（`SetWindowsHookEx`）