#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <linux/uinput.h>
#include <linux/input.h>

static int uinput_fd = -1;
static volatile sig_atomic_t g_running = 1;

static void handle_signal(int sig) {
    (void)sig;
    g_running = 0;
}

static void emit(int type, int code, int val) {
    if (uinput_fd < 0) return;
    struct input_event ie;
    memset(&ie, 0, sizeof(ie));
    ie.type = type;
    ie.code = code;
    ie.value = val;
    ssize_t ret = write(uinput_fd, &ie, sizeof(ie));
    (void)ret; /* Kernel write to uinput */
}

static void syn(void) {
    emit(EV_SYN, SYN_REPORT, 0);
}

static void cleanup_uinput(void) {
    if (uinput_fd >= 0) {
        ioctl(uinput_fd, UI_DEV_DESTROY);
        close(uinput_fd);
        uinput_fd = -1;
    }
}

static int init_uinput(void) {
    uinput_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (uinput_fd < 0) {
        perror("Cannot open /dev/uinput");
        return -1;
    }

    /* Enable relative mouse events */
    ioctl(uinput_fd, UI_SET_EVBIT, EV_REL);
    ioctl(uinput_fd, UI_SET_RELBIT, REL_X);
    ioctl(uinput_fd, UI_SET_RELBIT, REL_Y);
    ioctl(uinput_fd, UI_SET_RELBIT, REL_WHEEL);
    ioctl(uinput_fd, UI_SET_RELBIT, REL_HWHEEL);

    /* Enable mouse buttons */
    ioctl(uinput_fd, UI_SET_EVBIT, EV_KEY);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_MIDDLE);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_SIDE);
    ioctl(uinput_fd, UI_SET_KEYBIT, BTN_EXTRA);

    /* Enable all valid keyboard keys */
    for (int k = 1; k <= KEY_MAX; k++) {
        ioctl(uinput_fd, UI_SET_KEYBIT, k);
    }

    struct uinput_setup usetup;
    memset(&usetup, 0, sizeof(usetup));
    usetup.id.bustype = BUS_USB;
    usetup.id.vendor = 0x1234;
    usetup.id.product = 0x5678;
    usetup.id.version = 1;
    strncpy(usetup.name, "PhoneControl Virtual Input", sizeof(usetup.name) - 1);

    if (ioctl(uinput_fd, UI_DEV_SETUP, &usetup) < 0) {
        perror("UI_DEV_SETUP failed");
        close(uinput_fd);
        uinput_fd = -1;
        return -1;
    }

    if (ioctl(uinput_fd, UI_DEV_CREATE) < 0) {
        perror("UI_DEV_CREATE failed");
        close(uinput_fd);
        uinput_fd = -1;
        return -1;
    }

    return 0;
}

static int get_btn_code(int btn_idx) {
    switch (btn_idx) {
        case 0: return BTN_LEFT;
        case 1: return BTN_RIGHT;
        case 2: return BTN_MIDDLE;
        case 3: return BTN_SIDE;
        case 4: return BTN_EXTRA;
        default: return BTN_LEFT;
    }
}

/* Bounds clamping helper */
static int clamp_int(int val, int min_val, int max_val) {
    if (val < min_val) return min_val;
    if (val > max_val) return max_val;
    return val;
}

/* Character mapping to Linux keycode and shift requirement */
static int char_to_keycode(unsigned char c, int *need_shift) {
    *need_shift = 0;
    if (c >= 'a' && c <= 'z') return KEY_A + (c - 'a');
    if (c >= 'A' && c <= 'Z') { *need_shift = 1; return KEY_A + (c - 'A'); }
    if (c >= '1' && c <= '9') return KEY_1 + (c - '1');
    if (c == '0') return KEY_0;
    if (c == ' ') return KEY_SPACE;
    if (c == '\n' || c == '\r') return KEY_ENTER;
    if (c == '\t') return KEY_TAB;
    if (c == '\b') return KEY_BACKSPACE;
    if (c == '.') return KEY_DOT;
    if (c == ',') return KEY_COMMA;
    if (c == '-') return KEY_MINUS;
    if (c == '=') return KEY_EQUAL;
    if (c == '/') return KEY_SLASH;
    if (c == ';') return KEY_SEMICOLON;
    if (c == '\'') return KEY_APOSTROPHE;
    if (c == '[') return KEY_LEFTBRACE;
    if (c == ']') return KEY_RIGHTBRACE;
    if (c == '\\') return KEY_BACKSLASH;

    /* Shifted standard symbols */
    *need_shift = 1;
    if (c == '!') return KEY_1;
    if (c == '@') return KEY_2;
    if (c == '#') return KEY_3;
    if (c == '$') return KEY_4;
    if (c == '%') return KEY_5;
    if (c == '^') return KEY_6;
    if (c == '&') return KEY_7;
    if (c == '*') return KEY_8;
    if (c == '(') return KEY_9;
    if (c == ')') return KEY_0;
    if (c == '_') return KEY_MINUS;
    if (c == '+') return KEY_EQUAL;
    if (c == '?') return KEY_SLASH;
    if (c == ':') return KEY_SEMICOLON;
    if (c == '"') return KEY_APOSTROPHE;
    if (c == '{') return KEY_LEFTBRACE;
    if (c == '}') return KEY_RIGHTBRACE;
    if (c == '|') return KEY_BACKSLASH;
    if (c == '<') return KEY_COMMA;
    if (c == '>') return KEY_DOT;

    *need_shift = 0;
    return 0;
}

static void send_text(const char *text) {
    const unsigned char *p = (const unsigned char *)text;
    while (*p && g_running) {
        /* UTF-8 multi-byte character handling */
        if (*p == 0xc3) {
            /* Spanish vowels with accents and ñ */
            unsigned char next = *(p + 1);
            if (next == 0xb1) { /* ñ */
                emit(EV_KEY, KEY_SEMICOLON, 1); syn(); usleep(2000);
                emit(EV_KEY, KEY_SEMICOLON, 0); syn();
                p += 2; continue;
            } else if (next == 0x91) { /* Ñ */
                emit(EV_KEY, KEY_LEFTSHIFT, 1); syn();
                emit(EV_KEY, KEY_SEMICOLON, 1); syn(); usleep(2000);
                emit(EV_KEY, KEY_SEMICOLON, 0); syn();
                emit(EV_KEY, KEY_LEFTSHIFT, 0); syn();
                p += 2; continue;
            }
        }

        int need_shift = 0;
        int code = char_to_keycode(*p, &need_shift);
        if (code > 0 && code <= KEY_MAX) {
            if (need_shift) {
                emit(EV_KEY, KEY_LEFTSHIFT, 1);
                syn();
            }
            emit(EV_KEY, code, 1);
            syn();
            usleep(2000);
            emit(EV_KEY, code, 0);
            syn();
            if (need_shift) {
                emit(EV_KEY, KEY_LEFTSHIFT, 0);
                syn();
            }
            usleep(2000);
        }
        p++;
    }
}

int main(void) {
    /* Set up clean signal handlers */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = handle_signal;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGINT, &sa, NULL);
    sigaction(SIGTERM, &sa, NULL);
    sigaction(SIGHUP, &sa, NULL);
    signal(SIGPIPE, SIG_IGN); /* Ignore broken pipes gracefully */

    setvbuf(stdout, NULL, _IOLBF, 0);
    setvbuf(stdin, NULL, _IOLBF, 0);

    if (init_uinput() < 0) {
        fprintf(stderr, "ERROR: Failed to initialize uinput device.\n");
        return 1;
    }

    printf("READY\n");
    fflush(stdout);

    char line[1024];
    while (g_running && fgets(line, sizeof(line), stdin)) {
        size_t len = strlen(line);
        if (len == 0) continue;

        /* If line was too long and didn't contain newline, discard rest of line */
        if (line[len - 1] != '\n' && !feof(stdin)) {
            int ch;
            while ((ch = getchar()) != '\n' && ch != EOF) {}
        }

        /* Strip trailing newlines */
        line[strcspn(line, "\r\n")] = '\0';

        if (strncmp(line, "MOVE ", 5) == 0) {
            int dx = 0, dy = 0;
            if (sscanf(line + 5, "%d %d", &dx, &dy) == 2) {
                dx = clamp_int(dx, -2000, 2000);
                dy = clamp_int(dy, -2000, 2000);
                emit(EV_REL, REL_X, dx);
                emit(EV_REL, REL_Y, dy);
                syn();
            }
        } else if (strncmp(line, "BTN ", 4) == 0) {
            int btn = 0, state = 0;
            if (sscanf(line + 4, "%d %d", &btn, &state) == 2) {
                btn = clamp_int(btn, 0, 4);
                emit(EV_KEY, get_btn_code(btn), state ? 1 : 0);
                syn();
            }
        } else if (strncmp(line, "CLICK ", 6) == 0) {
            int btn = 0;
            if (sscanf(line + 6, "%d", &btn) == 1) {
                btn = clamp_int(btn, 0, 4);
                int code = get_btn_code(btn);
                emit(EV_KEY, code, 1);
                syn();
                usleep(4000);
                emit(EV_KEY, code, 0);
                syn();
            }
        } else if (strncmp(line, "SCROLL ", 7) == 0) {
            int dy = 0;
            if (sscanf(line + 7, "%d", &dy) == 1) {
                dy = clamp_int(dy, -500, 500);
                emit(EV_REL, REL_WHEEL, dy);
                syn();
            }
        } else if (strncmp(line, "HSCROLL ", 8) == 0) {
            int dx = 0;
            if (sscanf(line + 8, "%d", &dx) == 1) {
                dx = clamp_int(dx, -500, 500);
                emit(EV_REL, REL_HWHEEL, dx);
                syn();
            }
        } else if (strncmp(line, "KEY ", 4) == 0) {
            int code = 0, state = 0;
            if (sscanf(line + 4, "%d %d", &code, &state) == 2) {
                if (code >= 0 && code <= KEY_MAX) {
                    emit(EV_KEY, code, state ? 1 : 0);
                    syn();
                }
            }
        } else if (strncmp(line, "TAPKEY ", 7) == 0) {
            int code = 0;
            if (sscanf(line + 7, "%d", &code) == 1) {
                if (code >= 0 && code <= KEY_MAX) {
                    emit(EV_KEY, code, 1);
                    syn();
                    usleep(3000);
                    emit(EV_KEY, code, 0);
                    syn();
                }
            }
        } else if (strncmp(line, "TEXT ", 5) == 0) {
            send_text(line + 5);
        } else if (strcmp(line, "PING") == 0) {
            printf("PONG\n");
            fflush(stdout);
        } else if (strcmp(line, "QUIT") == 0) {
            break;
        }
    }

    cleanup_uinput();
    return 0;
}
