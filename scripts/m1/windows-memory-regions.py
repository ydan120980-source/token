"""Count committed virtual regions of a test process without reading their bytes."""
import ctypes as c
import ctypes.wintypes as w
import json
import sys


class Region(c.Structure):
    _fields_ = [("base", c.c_void_p), ("allocation", c.c_void_p),
                ("allocation_protect", w.DWORD), ("partition", w.WORD),
                ("bytes", c.c_size_t), ("state", w.DWORD), ("protect", w.DWORD),
                ("kind", w.DWORD)]


class SystemInfo(c.Structure):
    _fields_ = [("architecture", w.DWORD), ("page_size", w.DWORD),
                ("minimum", c.c_void_p), ("maximum", c.c_void_p),
                ("active_mask", c.c_size_t), ("processors", w.DWORD),
                ("processor_type", w.DWORD), ("granularity", w.DWORD),
                ("processor_level", w.WORD), ("processor_revision", w.WORD)]


def collect(pid):
    if c.sizeof(c.c_void_p) != 8 or pid <= 0:
        raise ValueError("MEMORY_REGION_ARGUMENT_INVALID")
    kernel = c.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
    kernel.OpenProcess.restype = w.HANDLE
    kernel.GetNativeSystemInfo.argtypes = [c.POINTER(SystemInfo)]
    kernel.VirtualQueryEx.argtypes = [w.HANDLE, c.c_void_p, c.POINTER(Region), c.c_size_t]
    kernel.VirtualQueryEx.restype = c.c_size_t
    kernel.CloseHandle.argtypes = [w.HANDLE]
    process = kernel.OpenProcess(0x0400, False, pid)  # PROCESS_QUERY_INFORMATION
    if not process:
        raise RuntimeError("MEMORY_REGION_OPEN_FAILED")
    totals = {"privateBytes": 0, "mappedBytes": 0, "imageBytes": 0, "reservedBytes": 0}
    fields = {0x20000: "privateBytes", 0x40000: "mappedBytes", 0x1000000: "imageBytes"}
    info = SystemInfo()
    kernel.GetNativeSystemInfo(c.byref(info))
    address = info.minimum
    try:
        while address < info.maximum:
            record = Region()
            if not kernel.VirtualQueryEx(process, address, c.byref(record), c.sizeof(record)):
                raise RuntimeError("MEMORY_REGION_QUERY_FAILED")
            if record.state == 0x1000 and record.kind in fields:
                totals[fields[record.kind]] += record.bytes
            elif record.state == 0x2000:
                totals["reservedBytes"] += record.bytes
            address = (record.base or 0) + record.bytes
    finally:
        kernel.CloseHandle(process)
    return totals


if __name__ == "__main__":
    print(json.dumps(collect(int(sys.argv[1]))))
