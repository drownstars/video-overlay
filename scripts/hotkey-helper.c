/**
 * 键盘钩子辅助程序
 * 使用原生 Win32 WH_KEYBOARD_LL 钩子，通过 stdout 输出按键事件
 * 编译: gcc -o hotkey-helper.exe hotkey-helper.c -luser32 -mwindows
 * 或使用 MSVC: cl hotkey-helper.c user32.lib /Fe:hotkey-helper.exe
 */

#include <windows.h>
#include <stdio.h>

#define MAX_KEYS 10

typedef struct {
    DWORD vkCode;
    DWORD modifiers;  // bit0=Ctrl, bit1=Alt, bit2=Shift, bit3=Win
    const char *name;
} HotkeyDef;

static HotkeyDef g_keys[MAX_KEYS];
static int g_keyCount = 0;
static HHOOK g_hook = NULL;
static DWORD g_modState = 0;

static int ParseKey(const char *name, DWORD *vk, DWORD *mods) {
    *mods = 0;
    
    // Parse modifiers
    while (1) {
        if (strncmp(name, "ctrl+", 5) == 0) { *mods |= 1; name += 5; }
        else if (strncmp(name, "alt+", 4) == 0) { *mods |= 2; name += 4; }
        else if (strncmp(name, "shift+", 6) == 0) { *mods |= 4; name += 6; }
        else if (strncmp(name, "win+", 4) == 0) { *mods |= 8; name += 4; }
        else break;
    }
    
    // Function keys
    if (name[0] == 'f' || name[0] == 'F') {
        int n = atoi(name + 1);
        if (n >= 1 && n <= 24) { *vk = VK_F1 + n - 1; return 1; }
    }
    
    // Space
    if (strcmp(name, "space") == 0) { *vk = VK_SPACE; return 1; }
    if (strcmp(name, "tab") == 0) { *vk = VK_TAB; return 1; }
    if (strcmp(name, "enter") == 0) { *vk = VK_RETURN; return 1; }
    if (strcmp(name, "esc") == 0 || strcmp(name, "escape") == 0) { *vk = VK_ESCAPE; return 1; }
    if (strcmp(name, "backspace") == 0) { *vk = VK_BACK; return 1; }
    if (strcmp(name, "up") == 0) { *vk = VK_UP; return 1; }
    if (strcmp(name, "down") == 0) { *vk = VK_DOWN; return 1; }
    if (strcmp(name, "left") == 0) { *vk = VK_LEFT; return 1; }
    if (strcmp(name, "right") == 0) { *vk = VK_RIGHT; return 1; }
    if (strcmp(name, "insert") == 0) { *vk = VK_INSERT; return 1; }
    if (strcmp(name, "delete") == 0) { *vk = VK_DELETE; return 1; }
    if (strcmp(name, "home") == 0) { *vk = VK_HOME; return 1; }
    if (strcmp(name, "end") == 0) { *vk = VK_END; return 1; }
    if (strcmp(name, "page_up") == 0) { *vk = VK_PRIOR; return 1; }
    if (strcmp(name, "page_down") == 0) { *vk = VK_NEXT; return 1; }
    
    // Single character
    if (strlen(name) == 1) {
        SHORT vkScan = VkKeyScanA(name[0]);
        *vk = LOBYTE(vkScan);
        return 1;
    }
    
    return 0;
}

LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode < 0) return CallNextHookEx(g_hook, nCode, wParam, lParam);
    
    KBDLLHOOKSTRUCT *ks = (KBDLLHOOKSTRUCT *)lParam;
    int isDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
    DWORD vk = ks->vkCode;
    
    // Track modifier state
    if (vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL) {
        if (isDown) g_modState |= 1; else g_modState &= ~1;
    } else if (vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU) {
        if (isDown) g_modState |= 2; else g_modState &= ~2;
    } else if (vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT) {
        if (isDown) g_modState |= 4; else g_modState &= ~4;
    } else if (vk == VK_LWIN || vk == VK_RWIN) {
        if (isDown) g_modState |= 8; else g_modState &= ~8;
    }
    
    // Check registered hotkeys
    if (isDown) {
        for (int i = 0; i < g_keyCount; i++) {
            if (g_keys[i].vkCode == vk && g_keys[i].modifiers == g_modState) {
                printf("KEY:%s\n", g_keys[i].name);
                fflush(stdout);
                break;
            }
        }
    }
    
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
}

int main(int argc, char *argv[]) {
    // Parse arguments: each argument is a key name like "f8" or "ctrl+shift+f8"
    if (argc < 2) {
        fprintf(stderr, "Usage: hotkey-helper.exe <key1> [key2] ...\n");
        return 1;
    }
    
    for (int i = 1; i < argc && g_keyCount < MAX_KEYS; i++) {
        DWORD vk, mods;
        if (ParseKey(argv[i], &vk, &mods)) {
            g_keys[g_keyCount].vkCode = vk;
            g_keys[g_keyCount].modifiers = mods;
            g_keys[g_keyCount].name = argv[i];
            g_keyCount++;
            fprintf(stderr, "Registered: %s (VK=0x%X mods=%d)\n", argv[i], vk, mods);
        }
    }
    
    if (g_keyCount == 0) {
        fprintf(stderr, "No valid keys specified\n");
        return 1;
    }
    
    // Install hook
    g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc, GetModuleHandle(NULL), 0);
    if (!g_hook) {
        fprintf(stderr, "Failed to install hook: %d\n", GetLastError());
        return 1;
    }
    
    fprintf(stderr, "Hook installed, listening for keys...\n");
    fflush(stderr);
    
    // Message loop
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    UnhookWindowsHookEx(g_hook);
    return 0;
}