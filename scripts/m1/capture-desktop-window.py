"""Capture only a window belonging to the specified synthetic app instance."""

import ctypes
from ctypes import wintypes
import json
import sys

from PIL import ImageGrab


def main():
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    user32.SetProcessDpiAwarenessContext.argtypes = [ctypes.c_void_p]
    user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    expected = int(sys.argv[1])
    windows = []
    callback = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    @callback
    def visit(hwnd, _):
        owner = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if (owner.value == expected and user32.IsWindowVisible(hwnd)
                and user32.GetWindowTextLengthW(hwnd)):
            rect = wintypes.RECT()
            if user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                windows.append(((rect.right - rect.left) * (rect.bottom - rect.top), hwnd))
        return True

    if len(sys.argv) > 3:
        visit(int(sys.argv[3]), 0)
    else:
        user32.EnumWindows.argtypes = [callback, wintypes.LPARAM]
        user32.EnumWindows(visit, 0)
    if not windows:
        raise SystemExit("NATIVE_WINDOW_NOT_FOUND")
    hwnd = max(windows)[1]
    if user32.GetForegroundWindow() != hwnd:
        raise SystemExit("NATIVE_CAPTURE_NOT_FOREGROUND")
    rect = wintypes.RECT()
    dwm = ctypes.WinDLL("dwmapi")
    dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
    if dwm.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(rect), ctypes.sizeof(rect)) != 0:
        raise SystemExit("NATIVE_CAPTURE_BOUNDS_FAILED")
    screenshot = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom), all_screens=True)
    if user32.GetForegroundWindow() != hwnd:
        raise SystemExit("NATIVE_CAPTURE_FOCUS_CHANGED")
    screenshot.save(sys.argv[2])
    print(json.dumps({"width": screenshot.width, "height": screenshot.height}))


if __name__ == "__main__":
    main()
