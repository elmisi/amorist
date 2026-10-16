#!/usr/bin/env python3
"""Focus or close the uniquely named QA window on the isolated X display."""
import ctypes as c
import sys

x = c.CDLL('libX11.so.6')
x.XOpenDisplay.argtypes = [c.c_char_p]
x.XOpenDisplay.restype = c.c_void_p
x.XDefaultRootWindow.argtypes = [c.c_void_p]
x.XDefaultRootWindow.restype = c.c_ulong
x.XQueryTree.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.POINTER(c.c_ulong)), c.POINTER(c.c_uint)]
x.XFetchName.argtypes = [c.c_void_p, c.c_ulong, c.POINTER(c.c_void_p)]
x.XInternAtom.argtypes = [c.c_void_p, c.c_char_p, c.c_int]
x.XInternAtom.restype = c.c_ulong
x.XGetWindowProperty.argtypes = [c.c_void_p, c.c_ulong, c.c_ulong, c.c_long, c.c_long, c.c_int, c.c_ulong, c.POINTER(c.c_ulong), c.POINTER(c.c_int), c.POINTER(c.c_ulong), c.POINTER(c.c_ulong), c.POINTER(c.c_void_p)]
x.XFree.argtypes = [c.c_void_p]
x.XSetInputFocus.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_ulong]
x.XSync.argtypes = [c.c_void_p, c.c_int]
x.XCloseDisplay.argtypes = [c.c_void_p]
display = x.XOpenDisplay(None)
if not display:
    raise RuntimeError('The isolated X display is unavailable')
matches = []
titles = []

def visit(window):
    name = c.c_void_p()
    kind, fmt, size, after = c.c_ulong(), c.c_int(), c.c_ulong(), c.c_ulong()
    x.XGetWindowProperty(display, window, x.XInternAtom(display, b'_NET_WM_NAME', 0), 0, 4096, 0, 0, c.byref(kind), c.byref(fmt), c.byref(size), c.byref(after), c.byref(name))
    if not name.value:
        x.XFetchName(display, window, c.byref(name))
    if name.value:
        try:
            title = c.string_at(name).decode('utf-8', errors='replace')
            titles.append(title)
            if title == sys.argv[1]:
                matches.append(window)
        finally:
            x.XFree(name)
    root, parent, count = c.c_ulong(), c.c_ulong(), c.c_uint()
    children = c.POINTER(c.c_ulong)()
    if x.XQueryTree(display, window, c.byref(root), c.byref(parent), c.byref(children), c.byref(count)):
        try:
            for i in range(count.value):
                visit(children[i])
        finally:
            if children:
                x.XFree(children)

try:
    visit(x.XDefaultRootWindow(display))
    if len(matches) != 1:
        raise RuntimeError(f'Expected one QA window, found {len(matches)}: {sys.argv[1]}; titles: {titles}')
    if len(sys.argv) == 4 and sys.argv[2] == '--close':
        pid = int(sys.argv[3])
        value = c.c_void_p()
        kind, fmt, count, after = c.c_ulong(), c.c_int(), c.c_ulong(), c.c_ulong()
        x.XGetWindowProperty(display, matches[0], x.XInternAtom(display, b'_NET_WM_PID', 0), 0, 1, 0, 0, c.byref(kind), c.byref(fmt), c.byref(count), c.byref(after), c.byref(value))
        try:
            if not value.value or fmt.value != 32 or count.value != 1 or c.cast(value, c.POINTER(c.c_ulong))[0] != pid:
                raise RuntimeError('QA window process identity does not match; close refused')
        finally:
            if value.value:
                x.XFree(value)
        class Data(c.Union):
            _fields_ = [('b', c.c_char * 20), ('s', c.c_short * 10), ('l', c.c_long * 5)]
        class Client(c.Structure):
            _fields_ = [('type', c.c_int), ('serial', c.c_ulong), ('send_event', c.c_int), ('display', c.c_void_p), ('window', c.c_ulong), ('message_type', c.c_ulong), ('format', c.c_int), ('data', Data)]
        class Event(c.Union):
            _fields_ = [('client', Client), ('pad', c.c_long * 24)]
        x.XSendEvent.argtypes = [c.c_void_p, c.c_ulong, c.c_int, c.c_long, c.POINTER(Event)]
        event = Event()
        event.client.type = 33
        event.client.send_event = 1
        event.client.display = display
        event.client.window = matches[0]
        event.client.message_type = x.XInternAtom(display, b'WM_PROTOCOLS', 0)
        event.client.format = 32
        event.client.data.l[0] = x.XInternAtom(display, b'WM_DELETE_WINDOW', 0)
        if not x.XSendEvent(display, matches[0], 0, 0, c.byref(event)):
            raise RuntimeError('Native close event could not be queued')
    else:
        if len(sys.argv) != 2:
            raise RuntimeError('Usage: focus-x11.py <title> [--close <owned-pid>]')
        x.XSetInputFocus(display, matches[0], 1, 0)
    x.XSync(display, 0)
finally:
    x.XCloseDisplay(display)
