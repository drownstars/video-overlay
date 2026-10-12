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