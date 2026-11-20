"""Keep writes, the SQLite locking region, and source SHM unavailable to readers."""
import ctypes
from ctypes import wintypes
import sys
from contextlib import ExitStack

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
create = kernel32.CreateFileW
create.argtypes = (
    wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
    wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE,
)
create.restype = wintypes.HANDLE
close = kernel32.CloseHandle
close.argtypes = (wintypes.HANDLE,)
close.restype = wintypes.BOOL


class Overlapped(ctypes.Structure):
    _fields_ = (
        ("internal", ctypes.c_size_t), ("internal_high", ctypes.c_size_t),
        ("offset", wintypes.DWORD), ("offset_high", wintypes.DWORD),
        ("event", wintypes.HANDLE),
    )


lock = kernel32.LockFileEx
lock.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
                 wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(Overlapped))
lock.restype = wintypes.BOOL


def handle(stack, path, share):
    opened = create(path, 0x80000000, share, None, 3, 0x80, None)
    if opened == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    stack.callback(close, opened)
    return opened


with ExitStack() as handles:
    file = sys.argv[1]
    if len(sys.argv) == 3 and sys.argv[2] == "--verify-released":
        for suffix in ("", "-wal", "-shm"):
            handle(handles, file + suffix, 0)
    else:
        main = handle(handles, file, 1)
        handle(handles, file + "-wal", 1)
        handle(handles, file + "-shm", 0)
        # SQLite takes pending, reserved and shared locks here.
        region = Overlapped(offset=0x40000000)
        if not lock(main, 3, 0, 512, 0, ctypes.byref(region)):
            raise ctypes.WinError(ctypes.get_last_error())
        print("ready", flush=True)
        sys.stdin.readline()
