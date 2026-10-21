# 视频小窗（video-overlay）

基于 Electron 的 B 站视频悬浮播放器。窗口无边框、可拖动缩放并始终置顶；视频播放、窗口布局和快捷键设置会保存在本机。

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动

```bash
npm start
```

Windows 用户也可以使用：

- `start.bat`：直接启动，不请求管理员权限。
- `start-admin.vbs`：以管理员权限在后台启动，不显示命令行窗口。
- `npm run create-shortcut`：在桌面创建“视频小窗”快捷方式；项目移动后重新运行即可更新路径。

`start.bat` 会优先运行本地 Electron，并立即关闭命令行窗口；首次运行或依赖缺失时会通过 npm 安装项目依赖。桌面快捷方式通过隐藏窗口的管理员启动脚本运行。

## 功能

- **置顶小窗**：无边框透明窗口，支持拖动、缩放和透明度调整。
- **全局控制**：窗口不在前台时也能播放/暂停、快进和快退。
- **快捷键独占**：Windows 低层键盘钩子会吞掉命中的按下和释放事件，前台软件不会重复响应。
- **断点续播**：按视频和分 P 保存播放时间，重新打开时自动恢复；接近片尾会从头开始。
- **关闭即退出**：关闭小窗后程序退出，并释放全局快捷键。
- **基础设置**：从小窗标题栏进入，可调整透明度、续播选项和全局快捷键，也可清除播放进度。
- **状态记忆**：保存窗口位置、大小、透明度、当前 URL 和 URL 历史。

## 快捷键

默认快捷键如下，可在设置窗口中重新录制：

| 功能 | 默认键 |
| --- | --- |
| 播放 / 暂停 | `F8` |
| 快进 | `F9` |
| 快退 | `F7` |

支持功能键、单字符按键以及 `Ctrl`、`Alt`、`Shift`、`Win` 组合键。Windows 使用 `scripts/hotkey-helper.ps1` 安装 `WH_KEYBOARD_LL` 钩子；其他平台回退到 Electron `globalShortcut`。

## 数据与恢复

- 状态文件：`%APPDATA%\video-overlay\video-overlay-state.json`
- 播放进度每 5 秒轮询一次，仅在进度变化达到阈值时写盘。
- 每个 B 站视频按 `BV号` 保存 `{ url, part, time, duration, updatedAt }`，最多保留 30 条。
- 命中“已无下一集”标记的视频不会自动跳转到下一 P；手动重新输入 URL 后可恢复正常续播。
- 设置窗口提供清除全部播放进度的操作。

## 项目结构

```text
video-overlay/
├── main/                      # Electron 主进程（ESM）
│   ├── index.mjs              # 入口：app 生命周期、单实例锁、模块装配
│   ├── constants.mjs          # 共享常量（窗口尺寸、名称、app id）
│   ├── state.mjs              # 状态持久化与内存缓存
│   ├── progress.mjs           # 播放进度、恢复判定与 B 站 URL 解析
│   ├── guest.mjs              # webview 访客：进度轮询与断点恢复注入
│   ├── hotkey.mjs             # 全局快捷键（Windows 低层钩子 / 回退 globalShortcut）
│   ├── overlay-window.mjs     # 覆盖小窗：创建、显示、销毁和边界保存
│   ├── settings-window.mjs    # 设置窗口
│   └── ipc.mjs                # ipcMain 通道注册
├── preload/index.js           # contextBridge 暴露 window.App API
├── renderer/                  # 小窗页面的预构建产物
├── settings/                  # 设置页面（原生 HTML/CSS/JS）
├── scripts/
│   ├── create-shortcut.ps1    # 创建桌面快捷方式
│   └── hotkey-helper.ps1      # C# P/Invoke 低层键盘钩子宿主
├── resources/icon.ico         # 快捷方式图标
├── start.bat                  # 直接启动
├── start-admin.vbs            # 管理员启动
```

### 主进程模块依赖

```text
index.mjs ──► overlay-window.mjs ──► (guest / hotkey / progress / state)
    │  └──► ipc.mjs ──► (overlay-window / guest / progress / state)
    └──► settings-window.mjs
state.mjs ◄── progress.mjs ◄── guest.mjs
```

## 开发

```bash
# 冒烟测试：启动后 3 秒自动退出
VIDEO_OVERLAY_SMOKE_TEST=1 npm start
```

主进程使用 ESM，模块文件位于 `main/`；设置页为原生 HTML/CSS/JS；`renderer/` 保存预构建的小窗页面。

提交改动前建议至少执行：

```bash
node --check main/index.mjs
node --check main/hotkey.mjs
git diff --check
```

## 常见问题

### 中文日志乱码

使用桌面快捷方式或 `start-admin.vbs` 启动时不会显示命令行窗口。直接从终端运行 `npm start` 时，日志会输出到当前终端。

### 快捷键没有生效

确认设置窗口中的按键没有重复。Windows 低层钩子需要在启动时成功安装；排查时可从终端运行 `npm start` 查看日志。

### 视频进度没有恢复

检查 `%APPDATA%\video-overlay\video-overlay-state.json` 是否存在，并确认设置中的“记忆播放进度”已开启。

## 技术栈

- Electron 37（主进程 ESM `.mjs`，Node 22）
- 渲染层：小窗为预构建 React 产物，设置页为原生 HTML/JS
- 低层键盘钩子：PowerShell + C# P/Invoke（`SetWindowsHookEx`）
