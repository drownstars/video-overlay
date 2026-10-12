import { getVideoOverlayState, MAX_URL_HISTORY, normalizeUrlHistory, readStateFile, writeStateFile } from "./state.mjs";

export const MAX_PROGRESS_ENTRIES = 30;
export const PROGRESS_POLL_MS = 5000;
const PROGRESS_SAVE_MIN_DELTA_SEC = 2;
export const PROGRESS_NEAR_END_MARGIN_SEC = 10;

export function extractVideoKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (!(host === "bilibili.com" || host.endsWith(".bilibili.com"))) return null;
    const bv = u.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i);
    if (bv) return bv[1].toLowerCase();
    const av = u.pathname.match(/\/video\/av(\d+)/i);
    if (av) return `av${av[1]}`;
    return null;
  } catch {
    return null;
  }
}

export function getPartFromUrl(url) {
  try {
    const p = new URL(url).searchParams.get("p");
    const n = Number(p);
    if (Number.isInteger(n) && n >= 1) return n;
  } catch {
  }
  return 1;
}

export function getProgressMap() {
  const value = readStateFile();
  const map = value?.progresses;
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  return map;
}

export function saveProgressMap(map) {
  const value = readStateFile() ?? {};
  value.progresses = map;
  writeStateFile(value);
}

export function clearProgressEntries() {
  saveProgressMap({});
}

function trimAndSaveProgress(map) {
  const entries = Object.entries(map).sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
  if (entries.length > MAX_PROGRESS_ENTRIES) {
    saveProgressMap(Object.fromEntries(entries.slice(0, MAX_PROGRESS_ENTRIES)));
  } else {
    saveProgressMap(map);
  }
}

export function saveProgressEntry(entry) {
  const url = typeof entry?.url === "string" ? entry.url : "";
  const key = extractVideoKey(url);
  if (!key) return;
  const part = Number(entry.part);
  const time = Number(entry.time);
  const duration = Number(entry.duration);
  if (!Number.isInteger(part) || part < 1) return;
  if (!Number.isFinite(time) || time < 0) return;
  const map = getProgressMap();
  const prev = map[key];
  if (prev && prev.part === part && Math.abs(Number(prev.time ?? 0) - time) < PROGRESS_SAVE_MIN_DELTA_SEC) {
    return;
  }
  map[key] = {
    ...prev,
    url,
    part,
    time: Math.floor(time),
    duration: Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : undefined,
    updatedAt: Date.now()
  };
  trimAndSaveProgress(map);
}

export function getRestoreForUrl(url) {
  try {
    if (!getVideoOverlayState().rememberProgress) return null;
    const key = extractVideoKey(url);
    if (!key) return null;
    const prog = getProgressMap()[key];
    if (!prog || !Number.isInteger(prog.part) || prog.part < 1) return null;
    if (prog.noNextPart) return null;
    const u = new URL(url);
    const explicitP = u.searchParams.get("p");
    if (explicitP !== null) {
      const p = Number(explicitP);
      if (Number.isInteger(p) && p !== prog.part) return null;
    }
    let time = Number(prog.time ?? 0);
    if (!Number.isFinite(time) || time < 0) time = 0;
    if (time > 0 && Number.isFinite(Number(prog.duration)) && time >= Number(prog.duration) - PROGRESS_NEAR_END_MARGIN_SEC) {
      time = 0;
    }
    const result = { key, part: prog.part, time };
    if (explicitP === null && prog.part > 1) {
      u.searchParams.set("p", String(prog.part));
      result.url = u.toString();
    }
    return result;
  } catch {
    return null;
  }
}

export function markNoNextPart(url) {
  const key = extractVideoKey(url);
  if (!key) return;
  const map = getProgressMap();
  const prev = map[key];
  if (prev?.noNextPart) return;
  map[key] = {
    ...(prev || {}),
    url,
    noNextPart: true,
    updatedAt: Date.now()
  };
  trimAndSaveProgress(map);
}

export function clearNoNextPart(url) {
  const key = extractVideoKey(url);
  if (!key) return;
  const map = getProgressMap();
  const prev = map[key];
  if (!prev || !prev.noNextPart) return;
  const { noNextPart, ...rest } = prev;
  map[key] = rest;
  saveProgressMap(map);
}

export function hasNoNextPart(url) {
  const key = extractVideoKey(url);
  if (!key) return false;
  return Boolean(getProgressMap()[key]?.noNextPart);
}

export function formatProgressTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function pushUrlHistory(url) {
  try {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url.trim())) return;
    const value = readStateFile() ?? {};
    const list = normalizeUrlHistory(value.urlHistory);
    const key = extractVideoKey(url);
    const filtered = list.filter((item) => {
      if (key) return extractVideoKey(item) !== key;
      return item !== url;
    });
    filtered.unshift(url);
    if (filtered.length > MAX_URL_HISTORY) {
      filtered.length = MAX_URL_HISTORY;
    }
    value.urlHistory = filtered;
    writeStateFile(value);
  } catch {
  }
}
