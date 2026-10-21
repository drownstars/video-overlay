# 视频小窗（video-overlay）

> 把 B 站网页播放器装进一个无边框、始终置顶的桌面小窗。

视频小窗是一个基于 Electron 的桌面悬浮播放器。窗口可拖动、缩放、调节透明度并始终置顶，适合边工作边看视频、把课程挂在屏幕角落，或在全屏应用旁边保留一个小播放器。

播放进度、窗口位置、快捷键和观看地址都保存在本机，重新打开后可以接着看。

**运行环境：** Windows 10/11 · Electron 37 · npm

## 目录

- [功能特性](#功能特性)
- [快速开始](#快速开始)
- [使用说明](#使用说明)
- [快捷键](#快捷键)
- [数据与断点续播](#数据与断点续播)
- [项目结构](#项目结构)
- [开发](#开发)
- [常见问题](#常见问题)
- [技术栈](#技术栈)

## 功能特性

- **悬浮小窗**：无边框、圆角、半透明窗口，默认 520 × 320，最小 320 × 180。
- **始终置顶**：窗口保持在其他应用之上，不占用任务栏。
- **拖动与缩放**：拖动标题栏移动，拖动左右/底部边缘调整尺寸。
- **透明度调节**：20%–100% 可调，设置面板中拖动时即时预览。
- **鼠标穿透锁定**：锁定后点击会穿透到下层应用；鼠标移到右上角可重新解锁。
- **地址栏与历史**：在小窗内输入视频地址即可播放，输入框会联想最近访问过的地址。
- **全局媒体控制**：窗口不在前台时也能播放/暂停、快进、快退。
- **快捷键独占**：Windows 下使用低层键盘钩子，命中快捷键时同时吞掉按下和释放事件，前台软件不会重复响应。
- **断点续播**：按视频（BV/av 号）和分 P 记录播放时间，再次打开时自动恢复，并显示恢复提示。
- **设置面板**：从小窗标题栏进入，可调整透明度、续播开关和全局快捷键，也可一键清除播放进度。
- **状态记忆**：保存窗口位置与大小、透明度、当前 URL、URL 历史和快捷键配置。
- **关闭即退出**：关闭小窗后进程退出，并释放全局快捷键与键盘钩子。
- **单实例运行**：重复启动不会打开第二个窗口，而是唤起已有小窗。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动

```bash
npm start
```

Windows 用户也可以直接双击或运行以下脚本：

| 脚本 | 说明 |
| --- | --- |
| `start.bat` | 直接启动；本地 Electron 缺失时会自动执行 `npm install`，并在启动后立即关闭命令行窗口。 |
| `start-admin.vbs` | 以管理员权限在后台启动，不显示命令行窗口，适合需要提升权限的环境。 |

首次启动会打开空白小窗，在地址栏中输入 B 站视频地址即可开始播放。

## 使用说明

1. **打开视频**：在小窗的地址输入框中粘贴 B 站视频链接（如 `https://www.bilibili.com/video/BV...`），按 `Enter` 或点击“打开网页”。
2. **切换视频**：点击标题栏的重新输入按钮，可重新填写地址；输入框会自动联想最近访问的 URL。
3. **调整窗口**：拖动标题栏移动窗口，拖动边缘缩放；设置的尺寸和位置会自动保存。
4. **锁定窗口**：点击标题栏的锁图标后，小窗不再拦截鼠标点击；点击右上角的解锁图标可恢复操作。
5. **打开设置**：点击标题栏的齿轮图标，打开独立的基础设置窗口。
6. **浏览器打开**：点击标题栏的外链图标，可在系统浏览器中打开当前视频。
7. **关闭退出**：点击标题栏的关闭按钮，应用会保存状态并直接退出。

> 想让视频占满整个小窗，请使用 B 站播放器里的“网页全屏”，不要使用“进入全屏”。后者会让网页进入系统全屏，可能覆盖整个桌面。

## 快捷键

默认快捷键如下，可在设置窗口中点击对应按钮后重新录制：

| 功能 | 默认键 | 行为 |
| --- | --- | --- |
| 播放 / 暂停 | `F8` | 切换当前视频的播放状态 |
| 快进 | `F9` | 前进 5 秒 |
| 快退 | `F7` | 后退 5 秒 |

快捷键全局生效，即使小窗不在前台也能控制播放。支持功能键、单字符按键，以及 `Ctrl`、`Alt`、`Shift`、`Win` 组合键；如果多个功能绑定到同一个按键，注册时只会保留其中一个。

### Windows 低层钩子

- 主进程通过 `scripts/hotkey-helper.ps1` 启动一个独立的 PowerShell 进程，用 C# P/Invoke 安装 `WH_KEYBOARD_LL` 钩子。
- 命中快捷键时，钩子会吞掉 keydown 和 keyup，前台软件不会收到这两个事件。
- 钩子进程意外退出后，会在 1 秒后自动重启。
- 非 Windows 平台回退到 Electron 的 `globalShortcut`，此时无法阻止前台软件响应同一按键。

## 数据与断点续播

### 状态文件

所有状态保存在 Electron 的 `userData` 目录：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\video-overlay\video-overlay-state.json` |
| macOS | `~/Library/Application Support/video-overlay/video-overlay-state.json` |
| Linux | `~/.config/video-overlay/video-overlay-state.json` |

状态文件结构示例：

```json
{
  "visible": true,
  "url": "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
  "opacity": 0.9,
  "playPauseKey": "f8",
  "seekForwardKey": "f9",
  "seekBackwardKey": "f7",
  "rememberProgress": true,
  "bounds": { "x": 1400, "y": 20, "width": 520, "height": 320 },
  "urlHistory": ["https://www.bilibili.com/video/BV1xx411c7mD?p=2"],
  "progresses": {
    "bv1xx411c7md": {
      "url": "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
      "part": 2,
      "time": 123,
      "duration": 600,
      "updatedAt": 1730000000000
    }
  }
}
```

### 保存规则

- 开启“自动记忆播放进度”后，每 5 秒读取一次网页播放器状态。
- 仅当播放时间变化达到 2 秒时才写入进度，避免频繁写盘。
- 每个视频按 BV 号或 av 号保存 `{ url, part, time, duration, updatedAt }`，最多保留最近更新的 30 条。
- URL 历史最多保留 20 条，用于地址输入框的联想。
- 窗口位置和大小在移动/缩放后延迟 300ms 保存，退出时再保存一次。

### 恢复规则

- 默认按视频 + 分 P 恢复；如果 URL 中显式指定了 `p` 参数且与记录不一致，则不会恢复。
- URL 未指定分 P、而记录的是第 2P 及以后时，会自动补上 `p` 参数并加载对应分 P。
- 距离片尾 10 秒以内时，再次打开会从头播放。
- 检测到“已无下一 P”的视频会跳过自动恢复；手动重新输入 URL 后会清除该标记。
- 设置面板中的“清除”会删除全部播放进度记录，但不会删除窗口位置和快捷键配置。

## 项目结构

```text
video-overlay/
├── main/                      # Electron 主进程（ESM）
│   ├── index.mjs              # 应用生命周期、单实例锁、模块装配
│   ├── constants.mjs          # 窗口尺寸、显示名、App ID 等常量
│   ├── state.mjs              # 状态读写、字段校验与内存缓存
│   ├── progress.mjs           # 进度存取、续播判定、URL 解析与历史
│   ├── guest.mjs              # webview 注入、进度轮询、恢复提示
│   ├── hotkey.mjs             # 快捷键注册与 PowerShell 钩子进程管理
│   ├── overlay-window.mjs     # 小窗创建/显示/销毁、边界与快捷键绑定
│   ├── settings-window.mjs    # 设置窗口
│   └── ipc.mjs                # ipcMain 通道注册
├── preload/index.js           # contextBridge 暴露 window.App API
├── renderer/                  # 小窗页面（预构建产物）
│   ├── index.html
│   └── assets/                # 打包后的 JS/CSS
├── settings/                  # 设置页（原生 HTML/CSS/JS）
├── scripts/
│   └── hotkey-helper.ps1      # C# P/Invoke 低层键盘钩子宿主
├── resources/icon.ico         # 图标资源
├── start.bat                  # 直接启动（缺依赖时自动安装）
└── start-admin.vbs            # 管理员权限静默启动
```

### 主进程模块依赖

```text
index.mjs ──► overlay-window.mjs ──► (guest / hotkey / progress / state)
    │  └──► ipc.mjs ──► (overlay-window / guest / progress / state)
    └──► settings-window.mjs
state.mjs ◄── progress.mjs ◄── guest.mjs
```

### 渲染进程 API

`preload/index.js` 通过 `contextBridge` 暴露以下接口：

- `window.App.videoOverlay`：状态读写、地址导航、窗口显示/隐藏、透明度预览、设置窗口、播放指令、进度清除。
- `window.App.launcher`：用系统浏览器打开外部链接。
- `window.App.windowControls`：最小化、最大化切换、关闭窗口。

## 开发

### 本地运行

```bash
# 安装依赖
npm install

# 启动小窗
npm start

# 只打开设置窗口
npm start -- --open-settings
```

### 冒烟测试

启动 3 秒后自动退出，用于确认应用能正常启动：

```bash
# macOS / Linux / Git Bash
VIDEO_OVERLAY_SMOKE_TEST=1 npm start
```

```powershell
# PowerShell
$env:VIDEO_OVERLAY_SMOKE_TEST = "1"; npm start
```

```bat
:: cmd
set VIDEO_OVERLAY_SMOKE_TEST=1 && npm start
```

### 提交前检查

```bash
for f in main/*.mjs preload/index.js settings/app.js; do node --check "$f"; done
git diff --check
```

### 修改界面

- `settings/` 是原生 HTML/CSS/JS，可直接修改。
- `renderer/` 是小窗页面的**预构建产物**；需要调整小窗界面时，应在对应的前端工程中重新构建，再替换 `renderer/assets/` 下的文件。
- 主进程使用 ESM（`.mjs`），修改后可通过 `node --check` 做语法检查。

## 常见问题

### 快捷键没有生效

1. 确认三个快捷键没有重复绑定。
2. 从终端运行 `npm start`，观察是否有钩子启动日志和快捷键触发日志。
3. 确认系统允许运行 PowerShell；安全软件拦截 `SetWindowsHookEx` 时钩子会启动失败。
4. 钩子进程退出后会自动重启；若持续失败，重启应用再试。

### 播放进度没有恢复

1. 确认设置中的“自动记忆播放进度”已开启。
2. 检查状态文件是否存在，以及 `progresses` 中是否有对应视频的记录。
3. 确认打开的是同一个视频和分 P；显式 `p` 参数与记录不一致时不会恢复。
4. 如果上次观看位置距离片尾不足 10 秒，会按从头播放处理。
5. 如果该视频被标记为“已无下一 P”，自动恢复会被跳过；重新输入一次 URL 即可清除标记。

### 中文日志乱码

`start.bat` 会设置 `chcp 65001` 并直接启动 Electron。使用 `start-admin.vbs` 时没有命令行窗口，也就看不到日志；需要排查时请从终端运行 `npm start`。

### 小窗跑到屏幕外

应用启动时会把保存的窗口位置限制在当前工作区内。如果仍然异常，可先退出应用，备份并删除状态文件后重新启动，让窗口回到默认位置。

### 网页加载失败或视频黑屏

- 确认网络可以正常访问 B 站，地址以 `https://` 开头。
- 点击标题栏的重新输入按钮，重新打开视频地址。
- 部分视频需要登录或受版权/地区限制，可能无法在小窗中播放。
- 网页进入“全屏”可能覆盖整个桌面，请改用播放器的“网页全屏”。

### 小窗无法覆盖全屏游戏

`alwaysOnTop` 只能覆盖窗口化或无边窗口化的应用。独占全屏游戏会接管显示输出，建议把游戏切换为“无边框窗口”模式。

## 技术栈

- **Electron 37**：主进程使用 ESM（`.mjs`），随附 Node.js 22。
- **渲染层**：小窗为预构建的 React 产物；设置页为原生 HTML/CSS/JS。
- **低层键盘钩子**：PowerShell + C# P/Invoke（`SetWindowsHookEx` / `WH_KEYBOARD_LL`）。
- **进程通信**：`contextBridge` + `ipcRenderer.invoke` / `ipcMain.handle`，渲染进程不直接访问 Node.js。
- **数据存储**：单个 JSON 状态文件，进程内缓存，避免频繁同步读盘。
