#!/usr/bin/env python3
"""Focus the uniquely named QA window on the test's isolated X display."""
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
    x.XSetInputFocus(display, matches[0], 1, 0)
    x.XSync(display, 0)
finally:
    x.XCloseDisplay(display)
