const App = window.App.videoOverlay;

const keyButtons = {
  playPauseKey: document.getElementById("key-play-pause"),
  seekForwardKey: document.getElementById("key-forward"),
  seekBackwardKey: document.getElementById("key-backward")
};
const opacityInput = document.getElementById("opacity");
const opacityVal = document.getElementById("opacity-val");
const rememberInput = document.getElementById("remember-progress");
const btnClearProgress = document.getElementById("btn-clear-progress");
const btnOpen = document.getElementById("btn-open");
const btnClose = document.getElementById("btn-close");

const KEY_MAP = {
  " ": "space", Tab: "tab", Enter: "enter", Escape: "esc", Backspace: "backspace",
  ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
  Insert: "insert", Delete: "delete", Home: "home", End: "end",
  PageUp: "page_up", PageDown: "page_down",
  F1: "f1", F2: "f2", F3: "f3", F4: "f4", F5: "f5", F6: "f6",
  F7: "f7", F8: "f8", F9: "f9", F10: "f10", F11: "f11", F12: "f12",
};

function formatKeyFromEvent(event) {
  if (KEY_MAP[event.key] !== undefined) return KEY_MAP[event.key];
  if (event.key.length === 1) return event.key.toLowerCase();
  const c = event.code;
  if (c.startsWith("Key")) return c.slice(3).toLowerCase();
  if (c.startsWith("Digit")) return c.slice(5);
  if (c.startsWith("Numpad")) return "numpad_" + c.slice(6).toLowerCase();
  return c.toLowerCase();
}

function formatMouseButton(button) {
  const map = { 0: "mouse_left", 1: "mouse_middle", 2: "mouse_right" };
  return map[button] ?? `mouse_x${button - 2}`;
}

let currentCapture = null;

function clearCurrentCapture() {
  if (currentCapture) {
    window.removeEventListener("keydown", currentCapture.keydown, true);
    window.removeEventListener("keyup", currentCapture.keyup, true);
    window.removeEventListener("mousedown", currentCapture.mousedown, true);
    currentCapture = null;
  }
}

function startCapture(keyName, button) {
  clearCurrentCapture();
  button.classList.add("capturing");
  button.textContent = "请按下快捷键";
  const previousValue = button.dataset.value ?? "";
  let active = true;
  const modifiers = { ctrl: false, alt: false, shift: false, meta: false };

  const finish = (value) => {
    if (!active) return;
    active = false;
    clearCurrentCapture();
    button.classList.remove("capturing");
    if (value !== undefined) {
      button.textContent = value;
      button.dataset.value = value;
      const patch = {};
      patch[keyName] = value;
      App.setState(patch);
    }
  };

  const formatAccelerator = (e) => {
    const key = formatKeyFromEvent(e);
    if (!key) return null;
    const parts = [];
    if (modifiers.ctrl) parts.push("ctrl");
    if (modifiers.alt) parts.push("alt");
    if (modifiers.shift) parts.push("shift");
    if (modifiers.meta) parts.push("win");
    parts.push(key);
    return parts.join("+");
  };

  const MOD_KEYS = { Control: "ctrl", Alt: "alt", Shift: "shift", Meta: "meta" };

  const handleKeyDown = (e) => {
    if (MOD_KEYS[e.key]) { modifiers[MOD_KEYS[e.key]] = true; return; }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      button.textContent = previousValue;
      finish(undefined);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const accel = formatAccelerator(e);
    if (accel) finish(accel);
  };

  const handleKeyUp = (e) => {
    if (MOD_KEYS[e.key]) modifiers[MOD_KEYS[e.key]] = false;
  };

  const handleMouseDown = (e) => {
    if (e.button === 0) {
      button.textContent = previousValue;
      finish(undefined);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    finish(formatMouseButton(e.button));
  };

  currentCapture = { keydown: handleKeyDown, keyup: handleKeyUp, mousedown: handleMouseDown };
  window.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", handleKeyUp, true);
  window.addEventListener("mousedown", handleMouseDown, true);
}

Object.entries(keyButtons).forEach(([keyName, button]) => {
  button.addEventListener("click", () => startCapture(keyName, button));
});

opacityInput.addEventListener("input", () => {
  opacityVal.textContent = `${opacityInput.value}%`;
  App.previewOpacity(Number(opacityInput.value) / 100);
});
opacityInput.addEventListener("change", () => {
  App.setState({ opacity: Number(opacityInput.value) / 100 });
});

rememberInput.addEventListener("change", () => {
  App.setState({ rememberProgress: rememberInput.checked });
});

btnClearProgress.addEventListener("click", async () => {
  try {
    await App.clearProgress();
    btnClearProgress.textContent = "已清除";
    btnClearProgress.disabled = true;
    setTimeout(() => {
      btnClearProgress.textContent = "清除";
      btnClearProgress.disabled = false;
    }, 1500);
  } catch {
    btnClearProgress.textContent = "失败";
    setTimeout(() => {
      btnClearProgress.textContent = "清除";
    }, 1500);
  }
});

btnOpen.addEventListener("click", async () => {
  await App.show();
  await App.focusInput();
});
btnClose.addEventListener("click", () => {
  App.hide();
});

function applyState(state) {
  if (!state) return;
  opacityInput.value = Math.round(state.opacity * 100);
  opacityVal.textContent = `${opacityInput.value}%`;
  rememberInput.checked = state.rememberProgress !== false;
  const keys = {
    playPauseKey: state.playPauseKey,
    seekForwardKey: state.seekForwardKey,
    seekBackwardKey: state.seekBackwardKey
  };
  Object.entries(keys).forEach(([keyName, value]) => {
    if (value) {
      const button = keyButtons[keyName];
      if (button) {
        button.textContent = value;
        button.dataset.value = value;
      }
    }
  });
}

App.getState().then(applyState).finally(() => {
  btnOpen.disabled = false;
  btnClose.disabled = false;
});
App.onState(applyState);
