#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0600
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int clamp_int(int val, int min_val, int max_val) {
    if (val < min_val) return min_val;
    if (val > max_val) return max_val;
    return val;
}

static BOOL is_extended_key(WORD vk) {
    return (vk >= 0x21 && vk <= 0x28) || vk == 0x2E || vk == 0x2D || vk == 0x5B || vk == 0x5C || vk == 0xA3 || vk == 0xA5;
}

static void send_mouse_move(int dx, int dy) {
    INPUT input;
    memset(&input, 0, sizeof(INPUT));
    input.type = INPUT_MOUSE;
    input.mi.dx = dx;
    input.mi.dy = dy;
    input.mi.dwFlags = MOUSEEVENTF_MOVE;
    SendInput(1, &input, sizeof(INPUT));
}

static void send_mouse_button(int btn, int state) {
    INPUT input;
    memset(&input, 0, sizeof(INPUT));
    input.type = INPUT_MOUSE;

    switch (btn) {
        case 0:
            input.mi.dwFlags = state ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
            break;
        case 1:
            input.mi.dwFlags = state ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
            break;
        case 2:
            input.mi.dwFlags = state ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
            break;
        case 3:
            input.mi.dwFlags = state ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON1;
            break;
        case 4:
            input.mi.dwFlags = state ? MOUSEEVENTF_XDOWN : MOUSEEVENTF_XUP;
            input.mi.mouseData = XBUTTON2;
            break;
        default:
            input.mi.dwFlags = state ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
            break;
    }
    SendInput(1, &input, sizeof(INPUT));
}

static void send_mouse_click(int btn) {
    send_mouse_button(btn, 1);
    Sleep(4);
    send_mouse_button(btn, 0);
}

static void send_mouse_scroll(int dy) {
    INPUT input;
    memset(&input, 0, sizeof(INPUT));
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_WHEEL;
    input.mi.mouseData = (DWORD)(dy * 30);
    SendInput(1, &input, sizeof(INPUT));
}

static void send_mouse_hscroll(int dx) {
    INPUT input;
    memset(&input, 0, sizeof(INPUT));
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = MOUSEEVENTF_HWHEEL;
    input.mi.mouseData = (DWORD)(dx * 30);
    SendInput(1, &input, sizeof(INPUT));
}

static void send_key(WORD vk, int state) {
    INPUT input;
    memset(&input, 0, sizeof(INPUT));
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = vk;

    DWORD flags = 0;
    if (!state) flags |= KEYEVENTF_KEYUP;
    if (is_extended_key(vk)) flags |= KEYEVENTF_EXTENDEDKEY;

    input.ki.dwFlags = flags;
    SendInput(1, &input, sizeof(INPUT));
}

static void send_tap_key(WORD vk) {
    send_key(vk, 1);
    Sleep(3);
    send_key(vk, 0);
}

static void send_text_utf8(const char *utf8_str) {
    int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8_str, -1, NULL, 0);
    if (wlen <= 1) return;

    WCHAR *wbuf = (WCHAR *)malloc(wlen * sizeof(WCHAR));
    if (!wbuf) return;

    MultiByteToWideChar(CP_UTF8, 0, utf8_str, -1, wbuf, wlen);

    for (int i = 0; wbuf[i] != L'\0'; i++) {
        INPUT inputs[2];
        memset(inputs, 0, sizeof(inputs));

        inputs[0].type = INPUT_KEYBOARD;
        inputs[0].ki.wScan = wbuf[i];
        inputs[0].ki.dwFlags = KEYEVENTF_UNICODE;

        inputs[1].type = INPUT_KEYBOARD;
        inputs[1].ki.wScan = wbuf[i];
        inputs[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;

        SendInput(2, inputs, sizeof(INPUT));
        Sleep(2);
    }

    free(wbuf);
}

int main(void) {
    SetConsoleOutputCP(CP_UTF8);
    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stdin, NULL, _IOLBF, 0);

    printf("READY\n");
    fflush(stdout);

    char line[1024];
    while (fgets(line, sizeof(line), stdin)) {
        size_t len = strlen(line);
        if (len == 0) continue;

        line[strcspn(line, "\r\n")] = '\0';

        if (strncmp(line, "MOVE ", 5) == 0) {
            int dx = 0, dy = 0;
            if (sscanf(line + 5, "%d %d", &dx, &dy) == 2) {
                send_mouse_move(clamp_int(dx, -2000, 2000), clamp_int(dy, -2000, 2000));
            }
        } else if (strncmp(line, "BTN ", 4) == 0) {
            int btn = 0, state = 0;
            if (sscanf(line + 4, "%d %d", &btn, &state) == 2) {
                send_mouse_button(clamp_int(btn, 0, 4), state);
            }
        } else if (strncmp(line, "CLICK ", 6) == 0) {
            int btn = 0;
            if (sscanf(line + 6, "%d", &btn) == 1) {
                send_mouse_click(clamp_int(btn, 0, 4));
            }
        } else if (strncmp(line, "SCROLL ", 7) == 0) {
            int dy = 0;
            if (sscanf(line + 7, "%d", &dy) == 1) {
                send_mouse_scroll(clamp_int(dy, -500, 500));
            }
        } else if (strncmp(line, "HSCROLL ", 8) == 0) {
            int dx = 0;
            if (sscanf(line + 8, "%d", &dx) == 1) {
                send_mouse_hscroll(clamp_int(dx, -500, 500));
            }
        } else if (strncmp(line, "KEY ", 4) == 0) {
            int code = 0, state = 0;
            if (sscanf(line + 4, "%d %d", &code, &state) == 2) {
                if (code > 0 && code <= 0xFFFF) {
                    send_key((WORD)code, state);
                }
            }
        } else if (strncmp(line, "TAPKEY ", 7) == 0) {
            int code = 0;
            if (sscanf(line + 7, "%d", &code) == 1) {
                if (code > 0 && code <= 0xFFFF) {
                    send_tap_key((WORD)code);
                }
            }
        } else if (strncmp(line, "TEXT ", 5) == 0) {
            send_text_utf8(line + 5);
        } else if (strcmp(line, "PING") == 0) {
            printf("PONG\n");
            fflush(stdout);
        } else if (strcmp(line, "QUIT") == 0) {
            break;
        }
    }

    return 0;
}
