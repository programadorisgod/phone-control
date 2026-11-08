using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace PhoneControl
{
    class WindowsDriver
    {
        private const int INPUT_MOUSE = 0;
        private const int INPUT_KEYBOARD = 1;

        private const uint MOUSEEVENTF_MOVE = 0x0001;
        private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        private const uint MOUSEEVENTF_LEFTUP = 0x0004;
        private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        private const uint MOUSEEVENTF_XDOWN = 0x0080;
        private const uint MOUSEEVENTF_XUP = 0x0100;
        private const uint MOUSEEVENTF_WHEEL = 0x0800;
        private const uint MOUSEEVENTF_HWHEEL = 0x1000;

        private const uint XBUTTON1 = 0x0001;
        private const uint XBUTTON2 = 0x0002;

        private const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        private const uint KEYEVENTF_KEYUP = 0x0002;
        private const uint KEYEVENTF_UNICODE = 0x0004;

        private const ushort VK_SPACE = 0x20;

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        private static bool IsExtendedKey(ushort vk)
        {
            // Arrow keys, Home, End, PageUp, PageDown, Delete, Insert, Win key, Right Ctrl/Alt
            return (vk >= 0x21 && vk <= 0x28) || vk == 0x2E || vk == 0x2D || vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5;
        }

        private static void SendMouseMove(int dx, int dy)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dx = dx;
            inputs[0].u.mi.dy = dy;
            inputs[0].u.mi.dwFlags = MOUSEEVENTF_MOVE;
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendMouseButton(int btn, int state)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;

            switch (btn)
            {
                case 0: // Left
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                    break;
                case 1: // Right
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
                    break;
                case 2: // Middle
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
                    break;
                case 3: // Side
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
                    inputs[0].u.mi.mouseData = XBUTTON1;
                    break;
                case 4: // Extra
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
                    inputs[0].u.mi.mouseData = XBUTTON2;
                    break;
                default:
                    inputs[0].u.mi.dwFlags = (state != 0) ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
                    break;
            }

            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendMouseClick(int btn)
        {
            SendMouseButton(btn, 1);
            Thread.Sleep(4);
            SendMouseButton(btn, 0);
        }

        private static void SendMouseScroll(int dy)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dwFlags = MOUSEEVENTF_WHEEL;
            inputs[0].u.mi.mouseData = unchecked((uint)(dy * 30));
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendMouseHScroll(int dx)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_MOUSE;
            inputs[0].u.mi.dwFlags = MOUSEEVENTF_HWHEEL;
            inputs[0].u.mi.mouseData = unchecked((uint)(dx * 30));
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendKey(ushort vk, int state)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki.wVk = vk;
            inputs[0].u.ki.wScan = 0;

            uint flags = 0;
            if (state == 0) flags |= KEYEVENTF_KEYUP;
            if (IsExtendedKey(vk)) flags |= KEYEVENTF_EXTENDEDKEY;

            inputs[0].u.ki.dwFlags = flags;
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendTapKey(ushort vk)
        {
            SendKey(vk, 1);
            Thread.Sleep(3);
            SendKey(vk, 0);
        }

        private static void SendText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;

            foreach (char c in text)
            {
                if (c == ' ')
                {
                    // For maximum compatibility across all Windows apps, send VK_SPACE
                    INPUT[] spaceInputs = new INPUT[2];
                    spaceInputs[0].type = INPUT_KEYBOARD;
                    spaceInputs[0].u.ki.wVk = VK_SPACE;
                    spaceInputs[0].u.ki.dwFlags = 0;

                    spaceInputs[1].type = INPUT_KEYBOARD;
                    spaceInputs[1].u.ki.wVk = VK_SPACE;
                    spaceInputs[1].u.ki.dwFlags = KEYEVENTF_KEYUP;

                    SendInput(2, spaceInputs, Marshal.SizeOf(typeof(INPUT)));
                    Thread.Sleep(2);
                    continue;
                }

                INPUT[] inputs = new INPUT[2];

                // Key down with UNICODE
                inputs[0].type = INPUT_KEYBOARD;
                inputs[0].u.ki.wVk = 0;
                inputs[0].u.ki.wScan = (ushort)c;
                inputs[0].u.ki.dwFlags = KEYEVENTF_UNICODE;

                // Key up with UNICODE
                inputs[1].type = INPUT_KEYBOARD;
                inputs[1].u.ki.wVk = 0;
                inputs[1].u.ki.wScan = (ushort)c;
                inputs[1].u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

                SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
                Thread.Sleep(2);
            }
        }

        private static int Clamp(int val, int min, int max)
        {
            if (val < min) return min;
            if (val > max) return max;
            return val;
        }

        static void Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.InputEncoding = System.Text.Encoding.UTF8;

            Console.WriteLine("READY");
            Console.Out.Flush();

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.TrimEnd('\r', '\n');
                if (line.Length == 0) continue;

                if (line.StartsWith("MOVE "))
                {
                    string[] parts = line.Substring(5).Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2)
                    {
                        int dx, dy;
                        if (int.TryParse(parts[0], out dx) && int.TryParse(parts[1], out dy))
                        {
                            SendMouseMove(Clamp(dx, -2000, 2000), Clamp(dy, -2000, 2000));
                        }
                    }
                }
                else if (line.StartsWith("BTN "))
                {
                    string[] parts = line.Substring(4).Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2)
                    {
                        int btn, state;
                        if (int.TryParse(parts[0], out btn) && int.TryParse(parts[1], out state))
                        {
                            SendMouseButton(Clamp(btn, 0, 4), state);
                        }
                    }
                }
                else if (line.StartsWith("CLICK "))
                {
                    int btn;
                    if (int.TryParse(line.Substring(6).Trim(), out btn))
                    {
                        SendMouseClick(Clamp(btn, 0, 4));
                    }
                }
                else if (line.StartsWith("SCROLL "))
                {
                    int dy;
                    if (int.TryParse(line.Substring(7).Trim(), out dy))
                    {
                        SendMouseScroll(Clamp(dy, -500, 500));
                    }
                }
                else if (line.StartsWith("HSCROLL "))
                {
                    int dx;
                    if (int.TryParse(line.Substring(8).Trim(), out dx))
                    {
                        SendMouseHScroll(Clamp(dx, -500, 500));
                    }
                }
                else if (line.StartsWith("KEY "))
                {
                    string[] parts = line.Substring(4).Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2)
                    {
                        int code, state;
                        if (int.TryParse(parts[0], out code) && int.TryParse(parts[1], out state))
                        {
                            if (code > 0 && code <= 0xFFFF)
                            {
                                SendKey((ushort)code, state);
                            }
                        }
                    }
                }
                else if (line.StartsWith("TAPKEY "))
                {
                    int code;
                    if (int.TryParse(line.Substring(7).Trim(), out code))
                    {
                        if (code > 0 && code <= 0xFFFF)
                        {
                            SendTapKey((ushort)code);
                        }
                    }
                }
                else if (line.StartsWith("TEXT "))
                {
                    SendText(line.Substring(5));
                }
                else if (line == "PING")
                {
                    Console.WriteLine("PONG");
                    Console.Out.Flush();
                }
                else if (line == "QUIT")
                {
                    break;
                }
            }
        }
    }
}
