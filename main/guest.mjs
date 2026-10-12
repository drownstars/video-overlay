import { getVideoOverlayState, readStateFile, writeStateFile } from "./state.mjs";
import {
  clearNoNextPart,
  extractVideoKey,
  formatProgressTime,
  getPartFromUrl,
  getProgressMap,
  getRestoreForUrl,
  markNoNextPart,
  PROGRESS_POLL_MS,
  pushUrlHistory,
  saveProgressEntry
} from "./progress.mjs";

const READ_VIDEO_STATE_CODE = `(() => {
  const v = document.querySelector('video');
  if (!v || !(v instanceof HTMLVideoElement)) return null;
  return { time: v.currentTime, duration: v.duration, paused: v.paused };
})()`;

const READ_PART_INFO_CODE = `(() => {
  const init = window.__INITIAL_STATE__;
  const pages = init && init.videoData && Array.isArray(init.videoData.pages) ? init.videoData.pages : null;
  if (!pages || pages.length < 1) return null;
  return { total: pages.length };
})()`;

function buildSeekCode(seconds) {
  const target = Math.max(0, Number(seconds));
  return `(() => {
    const target = ${target};
    let attempts = 0;
    const trySeek = () => {
      const v = document.querySelector('video');
      if (v && v instanceof HTMLVideoElement && v.readyState >= 1 && Number.isFinite(v.duration) && v.duration > 0) {
        if (target >= v.duration - 1) return;
        try {
          v.currentTime = target;
          if (Math.abs(v.currentTime - target) < 2) {
            v.play().catch(() => {});
            return;
          }
        } catch (e) {}
      }
      if (++attempts > 40) return;
      setTimeout(trySeek, 500);
    };
    trySeek();
  })()`;
}

let overlayWindowGetter = () => null;

export function setOverlayWindowGetter(getter) {
  overlayWindowGetter = getter;
}

const RESTORE_BADGE_CSS = "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:rgba(15,23,42,.88);color:#fff;font-size:12px;line-height:1;padding:9px 13px;border-radius:10px;pointer-events:none;font-family:PingFang SC,Microsoft YaHei,sans-serif;transition:opacity .4s;box-shadow:0 4px 16px rgba(0,0,0,.25)";

function showRestoreBadge(text) {
  const win = overlayWindowGetter();
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => {
    const old = document.getElementById('whimbox-restore-badge');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'whimbox-restore-badge';
    el.textContent = ${JSON.stringify(text)};
    el.style.cssText = ${JSON.stringify(RESTORE_BADGE_CSS)};
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 2600);
    setTimeout(() => el.remove(), 3200);
  })()`).catch(err => console.warn("[video-overlay] badge 注入失败:", err));
}

function syncGuestUrl(wc) {
  try {
    const url = wc.getURL();
    if (!url || url === "about:blank" || !/^https?:\/\//i.test(url)) return;
    if (url === getVideoOverlayState().url) return;
    const value = readStateFile() ?? {};
    value.url = url;
    value.progresses = getProgressMap();
    writeStateFile(value);
    if (extractVideoKey(url)) {
      pushUrlHistory(url);
    }
    console.log(`[video-overlay] url synced ${url}`);
  } catch (err) {
    console.warn("[video-overlay] URL 同步失败:", err);
  }
}

let activeGuest = null;
let guestPollTimer = null;
let guestRestoreChecked = false;
let guestCurrent = null;

export function stopGuestPolling() {
  if (guestPollTimer) {
    clearInterval(guestPollTimer);
    guestPollTimer = null;
  }
}

export function startGuestPolling() {
  if (!activeGuest || activeGuest.isDestroyed()) return;
  stopGuestPolling();
  guestPollTimer = setInterval(() => void pollGuestState(), PROGRESS_POLL_MS);
}

async function readGuestVideoState(wc) {
  if (!wc || wc.isDestroyed()) return null;
  try {
    return await wc.executeJavaScript(READ_VIDEO_STATE_CODE);
  } catch {
    return null;
  }
}

async function syncNoNextPart(url, wc) {
  const key = extractVideoKey(url);
  if (!key || !wc || wc.isDestroyed()) return;
  try {
    const info = await wc.executeJavaScript(READ_PART_INFO_CODE);
    if (info && Number.isInteger(info.total) && info.total >= 1) {
      const part = getPartFromUrl(url);
      (part >= info.total && info.total >= 2) ? markNoNextPart(url) : clearNoNextPart(url);
    }
  } catch { /* ignore */ }
}

async function pollGuestState() {
  if (!activeGuest || activeGuest.isDestroyed()) return;
  const url = activeGuest.getURL();
  const key = extractVideoKey(url);
  if (!key) return;
  const part = getPartFromUrl(url);
  await syncNoNextPart(url, activeGuest);
  const state = await readGuestVideoState(activeGuest);
  if (state) {
    const time = Number(state.time);
    const duration = Number(state.duration);
    guestCurrent = { key, part, time, duration, url };
    saveProgressEntry({ url, part, time, duration });
  } else if (guestCurrent && guestCurrent.part !== part) {
    saveProgressEntry({ url, part, time: guestCurrent.time, duration: guestCurrent.duration });
  }
}

function applyGuestRestore(wc) {
  if (guestRestoreChecked) return;
  const url = wc.getURL();
  if (!url || url === "about:blank" || !extractVideoKey(url)) return;
  guestRestoreChecked = true;
  const restore = getRestoreForUrl(url);
  if (!restore) return;

  if (restore.url && wc.getURL() !== restore.url) {
    try { wc.stop(); wc.loadURL(restore.url); } catch (err) {
      console.warn("[video-overlay] 恢复加载失败:", err);
    }
  }

  if (restore.time > 0) {
    const seek = () => {
      if (!wc.isDestroyed()) wc.executeJavaScript(buildSeekCode(restore.time)).catch(() => {});
    };
    wc.once("dom-ready", seek);
    if (!restore.url || wc.getURL() === restore.url) seek();
  }

  console.log(`[video-overlay] restore ${restore.key} part=${restore.part} time=${restore.time}`);

  const partText = restore.part > 1 ? `第${restore.part}P` : "";
  const timeText = restore.time > 0 ? ` ${formatProgressTime(restore.time)}` : "";
  showRestoreBadge((partText || timeText) ? `已恢复：${partText}${timeText}`.trim() : "已恢复上次进度");
}

function onGuestNavigated(wc) {
  syncGuestUrl(wc);
  if (!guestRestoreChecked) {
    applyGuestRestore(wc);
  }
  const url = wc.getURL();
  const key = extractVideoKey(url);
  if (!key) return;
  const part = getPartFromUrl(url);
  if (guestCurrent && guestCurrent.key === key && guestCurrent.part === part && guestCurrent.time != null) {
    saveProgressEntry({ url, part, time: guestCurrent.time, duration: guestCurrent.duration });
    return;
  }
  void readGuestVideoState(wc).then((state) => {
    const time = state ? Number(state.time) : 0;
    const duration = state ? Number(state.duration) : undefined;
    guestCurrent = { key, part, time, duration, url };
    saveProgressEntry({ url, part, time, duration });
  });
}

export function attachGuest(wc) {
  activeGuest = wc;
  guestRestoreChecked = false;
  guestCurrent = null;
  wc.on("dom-ready", () => applyGuestRestore(wc));
  wc.on("did-navigate", () => onGuestNavigated(wc));
  wc.on("did-navigate-in-page", () => onGuestNavigated(wc));
  wc.on("destroyed", () => {
    if (activeGuest === wc) {
      activeGuest = null;
      guestCurrent = null;
      stopGuestPolling();
    }
  });
  if (getVideoOverlayState().rememberProgress) {
    startGuestPolling();
  }
}
