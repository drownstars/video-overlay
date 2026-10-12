# 键盘钩子辅助脚本 v2
# 使用 C# P/Invoke 安装 WH_KEYBOARD_LL 钩子，通过 stdout 输出按键事件

# 从命令行参数获取按键列表
$Keys = $args
if ($Keys.Count -eq 0) {
    $Keys = @("f8", "f9", "f7")
}

$code = @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class HotkeyHelper
{
    [StructLayout(LayoutKind.Sequential)]
    public struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, uint wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, uint wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [StructLayout(LayoutKind.Sequential)]
    public struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int pt_x;
        public int pt_y;
    }

    private static IntPtr _hookHandle = IntPtr.Zero;
    private static Dictionary<uint, string> _keyMap = new Dictionary<uint, string>();
    private static uint _modState = 0;

    private static uint VkFromName(string name)
    {
        uint mods = 0;
        while (true)
        {
            if (name.StartsWith("ctrl+")) { mods |= 1; name = name.Substring(5); continue; }
            if (name.StartsWith("alt+")) { mods |= 2; name = name.Substring(4); continue; }
            if (name.StartsWith("shift+")) { mods |= 4; name = name.Substring(6); continue; }
            if (name.StartsWith("win+")) { mods |= 8; name = name.Substring(4); continue; }
            break;
        }

        uint vk = 0;
        if (name.Length > 1 && name[0] == 'f')
        {
            int fn = 0;
            if (int.TryParse(name.Substring(1), out fn) && fn >= 1 && fn <= 24)
                vk = (uint)(0x70 + fn - 1);
        }
        else if (name == "space") vk = 0x20;
        else if (name == "tab") vk = 0x09;
        else if (name == "enter") vk = 0x0D;
        else if (name == "esc" || name == "escape") vk = 0x1B;
        else if (name == "backspace") vk = 0x08;
        else if (name == "up") vk = 0x26;
        else if (name == "down") vk = 0x28;
        else if (name == "left") vk = 0x25;
        else if (name == "right") vk = 0x27;
        else if (name.Length == 1)
            vk = (uint)char.ToUpper(name[0]);

        return vk | (mods << 16);
    }

    private static IntPtr HookCallback(int nCode, uint wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            KBDLLHOOKSTRUCT ks = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool isDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
            uint vk = ks.vkCode;

            // Track modifier state
            if (vk == 0x10 || vk == 0xA0 || vk == 0xA1)
            {
                if (isDown) _modState |= 1; else _modState &= ~1u;
            }
            else if (vk == 0x11 || vk == 0xA2 || vk == 0xA3)
            {
                if (isDown) _modState |= 2; else _modState &= ~2u;
            }
            else if (vk == 0x12 || vk == 0xA4 || vk == 0xA5)
            {
                if (isDown) _modState |= 4; else _modState &= ~4u;
            }
            else if (vk == 0x5B || vk == 0x5C)
            {
                if (isDown) _modState |= 8; else _modState &= ~8u;
            }

            if (isDown && _keyMap.ContainsKey(vk))
            {
                string name = _keyMap[vk];
                uint expectedMods = 0;
                foreach (var kv in _keyMap)
                {
                    if (kv.Value == name)
                    {
                        expectedMods = (kv.Key >> 16) & 0xF;
                        break;
                    }
                }
                if (_modState == expectedMods)
                {
                    Console.WriteLine("KEY:" + name);
                    Console.Out.Flush();
                }
            }
        }
        return CallNextHookEx(_hookHandle, nCode, wParam, lParam);
    }

    public static void Main(string[] args)
    {
        foreach (string key in args)
        {
            uint vkMods = VkFromName(key);
            uint vk = vkMods & 0xFFFF;
            if (vk != 0)
            {
                _keyMap[vk] = key;
                Console.Error.WriteLine("Registered: " + key + " (VK=0x" + vk.ToString("X") + ")");
            }
        }

        if (_keyMap.Count == 0)
        {
            Console.Error.WriteLine("No valid keys");
            return;
        }

        LowLevelKeyboardProc proc = HookCallback;
        _hookHandle = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        if (_hookHandle == IntPtr.Zero)
        {
            Console.Error.WriteLine("Failed to install hook");
            return;
        }

        Console.Error.WriteLine("Hook installed");
        Console.Error.Flush();

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) != 0) { }

        UnhookWindowsHookEx(_hookHandle);
    }
}
"@

Add-Type -TypeDefinition $code -Language CSharp -ReferencedAssemblies "System.Runtime.InteropServices"
[HotkeyHelper]::Main($Keys)