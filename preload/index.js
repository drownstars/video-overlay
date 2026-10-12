"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const API = {
  videoOverlay: {
    setIgnoreMouseEvents: (ignore, options) => ipcRenderer.invoke("video-overlay:set-ignore-mouse-events", ignore, options),
    show: () => ipcRenderer.invoke("video-overlay:show"),
    hide: () => ipcRenderer.invoke("video-overlay:hide"),
    getBounds: () => ipcRenderer.invoke("video-overlay:get-bounds"),
    setBounds: (x, y, width, height) => ipcRenderer.invoke("video-overlay:set-bounds", x, y, width, height),
    getState: () => ipcRenderer.invoke("video-overlay:get-state"),
    setState: (patch) => ipcRenderer.invoke("video-overlay:set-state", patch),
    navigate: (url) => ipcRenderer.invoke("video-overlay:navigate", url),
    clearProgress: () => ipcRenderer.invoke("video-overlay:clear-progress"),
    executePlaybackCommand: (command) => ipcRenderer.invoke("video-overlay:execute-playback-command", command),
    focusInput: () => ipcRenderer.invoke("video-overlay:focus-input"),
    onState: (callback) => {
      const listener = (_, state) => callback(state);
      ipcRenderer.on("video-overlay:state", listener);
      return () => {
        ipcRenderer.removeListener("video-overlay:state", listener);
      };
    },
    onNavigate: (callback) => {
      const listener = (_, url) => callback(url);
      ipcRenderer.on("video-overlay:navigate", listener);
      return () => {
        ipcRenderer.removeListener("video-overlay:navigate", listener);
      };
    },
    onPlaybackCommand: (callback) => {
      const listener = (_, command) => callback(command);
      ipcRenderer.on("video-overlay:playback-command", listener);
      return () => {
        ipcRenderer.removeListener("video-overlay:playback-command", listener);
      };
    },
    onFocusInput: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("video-overlay:focus-input", listener);
      return () => {
        ipcRenderer.removeListener("video-overlay:focus-input", listener);
      };
    }
  },
  launcher: {
    openExternal: (url) => ipcRenderer.send("launcher:open-external", url)
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close")
  }
};

contextBridge.exposeInMainWorld("App", API);