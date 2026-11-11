"""Read-only Windows process-tree counters. No GC, trim, caps or process mutation.

PDH uses the same private-working-set/private-byte gauges as the CIM
probe, in one query instead of repeated WMI process walks. English counter paths
are localized by PdhAddEnglishCounterW. Process V2 (Windows 11+) includes the PID
in every instance name: classic Process repeats names and cannot be joined by
name. Older hosts should use the existing CIM probe. Output never contains names.
"""
import argparse
import ctypes as c
from ctypes import wintypes as w
import json
import os
import sys
import time


class Raw(c.Structure):
    _fields_ = [("status", w.DWORD), ("stamp", w.FILETIME),
                ("first", c.c_longlong), ("second", c.c_longlong),
                ("multi", w.DWORD)]


class Item(c.Structure):
    _fields_ = [("name", w.LPWSTR), ("value", Raw)]


class Counters:
    def __init__(self):
        self.dll = c.WinDLL("pdh")
        self.dll.PdhOpenQueryW.argtypes = [w.LPCWSTR, c.c_size_t, c.POINTER(w.HANDLE)]
        self.dll.PdhAddEnglishCounterW.argtypes = [w.HANDLE, w.LPCWSTR, c.c_size_t, c.POINTER(w.HANDLE)]
        self.dll.PdhCollectQueryData.argtypes = [w.HANDLE]
        self.dll.PdhGetRawCounterArrayW.argtypes = [w.HANDLE, c.POINTER(w.DWORD), c.POINTER(w.DWORD), c.c_void_p]
        self.dll.PdhCloseQuery.argtypes = [w.HANDLE]
        for name in ("PdhOpenQueryW", "PdhAddEnglishCounterW", "PdhCollectQueryData", "PdhGetRawCounterArrayW", "PdhCloseQuery"):
            getattr(self.dll, name).restype = w.DWORD
        self.query = w.HANDLE()
        self.check(self.dll.PdhOpenQueryW(None, 0, c.byref(self.query)))
        self.handles = {}
        try:
            for key, counter in (("pid", "Process ID"), ("parent", "Creating Process ID"),
                                 ("working", "Working Set - Private"), ("private", "Private Bytes")):
                handle = w.HANDLE()
                self.check(self.dll.PdhAddEnglishCounterW(self.query, "\\Process V2(*)\\" + counter, 0, c.byref(handle)))
                self.handles[key] = handle
        except Exception:
            self.close()
            raise

    @staticmethod
    def check(code):
        if code:
            raise RuntimeError("COUNTER_QUERY_FAILED_" + hex(code))

    def values(self, handle):
        # A process can appear between sizing and reading. Retry with a fresh
        # required size rather than interpreting a truncated counter array.
        for _ in range(3):
            size, count = w.DWORD(), w.DWORD()
            status = self.dll.PdhGetRawCounterArrayW(handle, c.byref(size), c.byref(count), None)
            if status not in (0, 0x800007D2):
                self.check(status)
            data = c.create_string_buffer(size.value)
            status = self.dll.PdhGetRawCounterArrayW(handle, c.byref(size), c.byref(count), data)
            if status == 0x800007D2:
                continue
            self.check(status)
            items = c.cast(data, c.POINTER(Item))
            result = {}
            for i in range(count.value):
                if items[i].value.status in (0, 1):
                    if items[i].name in result:
                        raise RuntimeError("COUNTER_INSTANCE_NOT_UNIQUE")
                    result[items[i].name] = items[i].value.first
            return result
        raise RuntimeError("COUNTER_ARRAY_CHANGED")

    def read(self, root):
        self.check(self.dll.PdhCollectQueryData(self.query))
        values = {key: self.values(handle) for key, handle in self.handles.items()}
        records = {int(pid): (name, int(values["parent"].get(name, -1)))
                   for name, pid in values["pid"].items() if name != "_Total" and pid > 0}
        owned, queue = set(), [root]
        while queue:
            pid = queue.pop()
            if pid in owned:
                continue
            owned.add(pid)
            queue.extend(child for child, (_, parent) in records.items() if parent == pid and child not in owned)
        complete = all(pid in records and all(records[pid][0] in values[key] for key in self.handles)
                       for pid in owned)
        def total(key):
            return sum(values[key].get(records[pid][0], 0) for pid in owned if pid in records) / 1048576
        return {"at": int(time.time() * 1000), "pids": sorted(owned), "complete": complete,
                "privateWorkingMiB": total("working"), "privateMiB": total("private"),
                "processes": [{"pid": pid,
                               "privateWorkingMiB": values["working"].get(records[pid][0], 0) / 1048576,
                               "privateMiB": values["private"].get(records[pid][0], 0) / 1048576}
                              for pid in sorted(owned) if pid in records]}

    def close(self):
        if self.query:
            self.dll.PdhCloseQuery(self.query)
            self.query = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--stop-file", required=True)
    parser.add_argument("--count", type=int, default=0)
    args = parser.parse_args()
    if args.pid <= 0 or args.count < 0 or sys.platform != "win32":
        raise RuntimeError("COUNTER_ARGUMENT_INVALID")
    counters, end, count = Counters(), time.monotonic() + 480, 0
    try:
        while time.monotonic() < end and not os.path.exists(args.stop_file):
            begin = time.monotonic()
            try:
                row = counters.read(args.pid)
            except RuntimeError:
                row = {"at": int(time.time() * 1000), "error": "COUNTER_QUERY_FAILED"}
            print(json.dumps(row, separators=(",", ":")), flush=True)
            count += 1
            if args.count and count >= args.count:
                break
            time.sleep(max(0, 0.1 - (time.monotonic() - begin)))
    finally:
        counters.close()


if __name__ == "__main__":
    main()
