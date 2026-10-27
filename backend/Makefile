CC ?= gcc
CFLAGS ?= -O2 -Wall -Wextra

all: uinput_driver

uinput_driver: uinput_driver.c
	$(CC) $(CFLAGS) -o uinput_driver uinput_driver.c

clean:
	rm -f uinput_driver

.PHONY: all clean
