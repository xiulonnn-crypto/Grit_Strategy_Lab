from __future__ import annotations

import os


def read_runtime_memory_status() -> dict[str, float]:
    total_physical_bytes = 0
    available_physical_bytes = 0
    process_working_set_bytes = 0
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", wintypes.DWORD),
                ("dwMemoryLoad", wintypes.DWORD),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        class PROCESS_MEMORY_COUNTERS_EX(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
                ("PrivateUsage", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        psapi = ctypes.WinDLL("psapi", use_last_error=True)
        memory_status = MEMORYSTATUSEX()
        memory_status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        if kernel32.GlobalMemoryStatusEx(ctypes.byref(memory_status)):
            total_physical_bytes = int(memory_status.ullTotalPhys or 0)
            available_physical_bytes = int(memory_status.ullAvailPhys or 0)
        counters = PROCESS_MEMORY_COUNTERS_EX()
        counters.cb = ctypes.sizeof(PROCESS_MEMORY_COUNTERS_EX)
        current_process = kernel32.GetCurrentProcess()
        if psapi.GetProcessMemoryInfo(current_process, ctypes.byref(counters), counters.cb):
            process_working_set_bytes = int(counters.WorkingSetSize or 0)
    else:
        try:
            page_size = int(os.sysconf("SC_PAGE_SIZE"))
            total_pages = int(os.sysconf("SC_PHYS_PAGES"))
            available_pages = int(os.sysconf("SC_AVPHYS_PAGES"))
            total_physical_bytes = page_size * total_pages
            available_physical_bytes = page_size * available_pages
        except (AttributeError, OSError, ValueError):
            total_physical_bytes = 0
            available_physical_bytes = 0
        try:
            import resource

            usage = resource.getrusage(resource.RUSAGE_SELF)
            process_working_set_bytes = int(usage.ru_maxrss) * 1024
        except Exception:
            process_working_set_bytes = 0

    used_physical_bytes = max(0, total_physical_bytes - available_physical_bytes)
    system_memory_ratio = (used_physical_bytes / total_physical_bytes) if total_physical_bytes else 0.0
    process_memory_ratio = (process_working_set_bytes / total_physical_bytes) if total_physical_bytes else 0.0
    return {
        "total_physical_bytes": float(total_physical_bytes),
        "available_physical_bytes": float(available_physical_bytes),
        "process_working_set_bytes": float(process_working_set_bytes),
        "system_memory_ratio": float(system_memory_ratio),
        "process_memory_ratio": float(process_memory_ratio),
    }
