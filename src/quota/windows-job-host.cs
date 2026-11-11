using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Text.RegularExpressions;

namespace AgentUsage {
  public sealed class JobResult {
    public string schemaVersion = "WindowsJobResultV1";
    public int? code;
    public string stdout = "", stderr = "", errorCode;
    public bool timedOut, canceled, overflow, parentExited, reaped;
  }
  public static class WindowsJobHost {
    [StructLayout(LayoutKind.Sequential)] struct Security { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long perProcess, perJob; public uint flags; public UIntPtr minimum, maximum; public uint active; public UIntPtr affinity; public uint priority, scheduling; }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit basic; public Io io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup { public int size; public string reserved, desktop, title; public uint x,y,width,height,charsX,charsY,fill,flags; public ushort show, reservedSize; public IntPtr reservedData, input, output, error; }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults, total, active, terminated; }
    [StructLayout(LayoutKind.Sequential)] struct Coord { public short x,y; public Coord(short a, short b) { x=a; y=b; } }
    [StructLayout(LayoutKind.Sequential)] struct Rect { public short a,b,c,d; }
    [StructLayout(LayoutKind.Sequential)] struct ConsoleInfo { public Coord size,cursor; public ushort attributes; public Rect window; public Coord maximum; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetConsoleScreenBufferInfo(IntPtr screen, out ConsoleInfo info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool ReadConsoleOutputCharacterW(IntPtr screen, StringBuilder text, uint length, Coord start, out uint read);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimit value, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting value, uint size, IntPtr returned);
    [DllImport("kernel32.dll", EntryPoint="QueryInformationJobObject", SetLastError=true)] static extern bool QueryJobProcessIds(IntPtr job, int type, IntPtr value, uint size, out uint returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder image, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security security, uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string file, uint access, uint share, ref Security security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref StartupEx startup, out ProcessInfo info);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadFile(IntPtr file, byte[] bytes, uint length, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    static void Need(bool value) { if (!value) throw new InvalidOperationException("JOB_HOST_UNAVAILABLE"); }
    static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle); handle = IntPtr.Zero; }
    static string Quote(string value) {
      StringBuilder result = new StringBuilder("\""); int slashes = 0;
      foreach (char ch in value) {
        if (ch == '\\') { slashes++; continue; }
        if (ch == '"') result.Append('\\', slashes * 2 + 1); else result.Append('\\', slashes);
        result.Append(ch); slashes = 0;
      }
      return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    static string Decode(byte[] bytes) {
      // A byte cap may split a final UTF-8 code point. Do not expand that tail
      // into replacement characters and accidentally exceed the output cap.
      char[] chars=new char[bytes.Length]; int used, count; bool complete;
      new UTF8Encoding(false, true).GetDecoder().Convert(bytes, 0, bytes.Length, chars, 0, chars.Length, false, out used, out count, out complete);
      return new string(chars, 0, count);
    }
    sealed class Capture {
      public readonly object gate = new object(); public int count; public bool overflow;
      public readonly MemoryStream output = new MemoryStream(), error = new MemoryStream();
      public void Read(IntPtr handle, MemoryStream target, int limit) {
        byte[] buffer = new byte[4096]; uint length;
        while (ReadFile(handle, buffer, (uint)buffer.Length, out length, IntPtr.Zero) && length > 0) lock(gate) {
          int keep = Math.Min((int)length, Math.Max(0, limit - count));
          target.Write(buffer, 0, keep); count += keep;
          if (keep != length) overflow = true;
        }
      }
    }
    sealed class LoginAuthUrl : IDisposable {
      readonly TextWriter events=Console.Out;
      IntPtr screen=IntPtr.Zero; bool attached, sent; string previous; long stableSince, lastPoll=-100;
      public void Poll(IntPtr job, string expectedImage, long rootCreated, long elapsed) {
        if (sent || elapsed-lastPoll<100) return; lastPoll=elapsed;
        IntPtr ids=Marshal.AllocHGlobal(8+64*IntPtr.Size);
        try {
          uint returned; if (!QueryJobProcessIds(job,3,ids,(uint)(8+64*IntPtr.Size),out returned)) return;
          int count=Marshal.ReadInt32(ids,4), matched=0; if(count<0||count>64) return;
          for(int index=0;index<count&&matched<8&&!sent;index++) {
            long id=Marshal.ReadIntPtr(ids,8+index*IntPtr.Size).ToInt64(); if(id<=0||id>Int32.MaxValue) continue;
            IntPtr process=OpenProcess(0x101000,false,(int)id); if(process==IntPtr.Zero) continue;
            try {
              bool member; long created,a,b,c; uint size=32768; StringBuilder image=new StringBuilder((int)size);
              if(!IsProcessInJob(process,job,out member)||!member||WaitForSingleObject(process,0)!=258||!GetProcessTimes(process,out created,out a,out b,out c)||created<rootCreated||!QueryFullProcessImageNameW(process,0,image,ref size)||!String.Equals(image.ToString(),expectedImage,StringComparison.OrdinalIgnoreCase)) continue;
              matched++; try { Read((uint)id,elapsed); } finally { Detach(); }
            } finally { Close(ref process); }
          }
        } finally { Marshal.FreeHGlobal(ids); }
      }
      void Read(uint pid,long elapsed) {
        if (!attached) { FreeConsole(); if (!AttachConsole(pid)) return; attached=true; }
        // A TUI can switch to an alternate screen after startup. Reopen the
        // current output buffer rather than retaining the initial buffer.
        Close(ref screen); Security security=new Security { length=Marshal.SizeOf(typeof(Security)), inherit=0 };
        screen=CreateFileW("CONOUT$", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero);
        if (screen==new IntPtr(-1)) { screen=IntPtr.Zero; return; }
        ConsoleInfo info; if (!GetConsoleScreenBufferInfo(screen, out info) || info.size.x<=0) return;
        int row=Math.Max(0, info.cursor.y-Math.Max(1,32768/info.size.x)+1), count=Math.Min(32768, (info.cursor.y-row+1)*info.size.x);
        StringBuilder text=new StringBuilder(count); uint read;
        if (!ReadConsoleOutputCharacterW(screen, text, (uint)count, new Coord(0,(short)row), out read)) return;
        // Console buffer cells preserve soft-wrap continuity. We never return
        // the buffer or keyboard input, only this one HTTPS authorization URL.
        string cells=text.ToString();
        // The interactive renderer adds left/right padding to every row of a
        // long link. Join only consecutive URI-only rows, never text inside a
        // row or a prompt, so encoded parameter bytes remain unchanged.
        StringBuilder logical=new StringBuilder(cells);
        for(int offset=0;offset<cells.Length;offset+=info.size.x) {
          string first=cells.Substring(offset,Math.Min(info.size.x,cells.Length-offset)).Trim();
          if(!first.StartsWith("https://accounts.google.com/",StringComparison.Ordinal)||!Regex.IsMatch(first,@"^[A-Za-z0-9:/?&=%._~+!$()*;,\[\]@-]+$")) continue;
          StringBuilder address=new StringBuilder(first);
          for(int next=offset+info.size.x;next<cells.Length&&address.Length<=16384&&address.Length>0&&first.Length>=info.size.x-2;next+=info.size.x) {
            string line=cells.Substring(next,Math.Min(info.size.x,cells.Length-next)).Trim();
            if(line.StartsWith("https://",StringComparison.Ordinal)||!Regex.IsMatch(line,@"^[A-Za-z0-9:/?&=%._~+!$()*;,\[\]@-]+$")) break;
            address.Append(line);
            if(line.Length<info.size.x-2) break;
          }
          if(address.Length<=16384) logical.Append('\n').Append(address).Append('\n');
        }
        MatchCollection matches=Regex.Matches(logical.ToString(), @"https://accounts\.google\.com/[^\s<>""']{1,16350}");
        string candidate=null;
        foreach (Match match in matches) if (Regex.IsMatch(match.Value,@"[?&]response_type=code(?:&|$)") && Regex.IsMatch(match.Value,@"[?&]state=[A-Za-z0-9_-]{16,512}(?:&|$)") && Regex.IsMatch(match.Value,@"[?&]code_challenge=[A-Za-z0-9_-]{43,128}(?:&|$)")) candidate=match.Value;
        if (candidate==null) return;
        if (candidate!=previous) { previous=candidate; stableSince=elapsed; return; }
        if (elapsed-stableSince<150) return;
        events.WriteLine("{\"schemaVersion\":\"WindowsJobAuthUrlV1\",\"url\":\""+candidate.Replace("\\","\\\\").Replace("\"","\\\"")+"\"}"); events.Flush(); sent=true; Dispose();
      }
      void Detach() { Close(ref screen); if(attached) { FreeConsole(); attached=false; } }
      public void Dispose() { Detach(); previous=null; }
    }
    public static JobResult Run(string executable, string expectedHash, string[] arguments, string cwd, string[] environment, int parentPid, int timeoutMs, int limit) {
      return Run(executable, expectedHash, arguments, cwd, environment, parentPid, timeoutMs, limit, false);
    }
    public static JobResult Run(string executable, string expectedHash, string[] arguments, string cwd, string[] environment, int parentPid, int timeoutMs, int limit, bool interactive) {
      return Run(executable, expectedHash, arguments, cwd, environment, parentPid, timeoutMs, limit, interactive, false);
    }
    public static JobResult Run(string executable, string expectedHash, string[] arguments, string cwd, string[] environment, int parentPid, int timeoutMs, int limit, bool interactive, bool authBrowser) {
      JobResult result = new JobResult(); Capture capture = new Capture();
      IntPtr job=IntPtr.Zero, parent=IntPtr.Zero, outRead=IntPtr.Zero, outWrite=IntPtr.Zero, errRead=IntPtr.Zero, errWrite=IntPtr.Zero, input=IntPtr.Zero;
      IntPtr attributes=IntPtr.Zero, handleList=IntPtr.Zero, jobList=IntPtr.Zero, environmentBlock=IntPtr.Zero;
      ProcessInfo process = new ProcessInfo(); bool initialized=false, created=false;
      Task outputTask=null, errorTask=null; FileStream pinned=null; List<IntPtr> directories = new List<IntPtr>(); LoginAuthUrl browser=null;
      TextReader ownerControl=Console.In;
      Task<string> cancellation=Task.Factory.StartNew(() => ownerControl.ReadLine());
      try {
        if (timeoutMs < 1 || timeoutMs > 600000 || limit < 1 || limit > 524288) throw new InvalidOperationException("JOB_REQUEST_INVALID");
        if (authBrowser && !interactive) throw new InvalidOperationException("JOB_REQUEST_INVALID");
        if (authBrowser) browser=new LoginAuthUrl();
        parent = OpenProcess(0x101000, false, parentPid); Need(parent != IntPtr.Zero);
        long parentCreated,a,b,c, hostCreated;
        Need(GetProcessTimes(parent, out parentCreated, out a, out b, out c));
        Need(GetProcessTimes(Process.GetCurrentProcess().Handle, out hostCreated, out a, out b, out c));
        Need(parentCreated <= hostCreated && WaitForSingleObject(parent, 0) == 258);
        Security security = new Security { length=Marshal.SizeOf(typeof(Security)), inherit=0 };
        // Hold ancestor directories against renames while resolving/starting the
        // pinned image. Directory contents remain writable; this is no sandbox.
        for (string directory=Path.GetDirectoryName(executable); directory != null; directory=Path.GetDirectoryName(directory)) {
          IntPtr handle=CreateFileW(directory, 0, 3, ref security, 3, 0x02000000, IntPtr.Zero);
          Need(handle != new IntPtr(-1)); directories.Add(handle);
          Need((File.GetAttributes(directory) & FileAttributes.ReparsePoint) == 0);
        }
        Need((File.GetAttributes(executable) & FileAttributes.ReparsePoint) == 0);
        pinned = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
        using (SHA256 sha=SHA256.Create()) {
          string actual=BitConverter.ToString(sha.ComputeHash(pinned)).Replace("-", "").ToLowerInvariant();
          if (actual != expectedHash) throw new InvalidOperationException("JOB_BINARY_CHANGED");
        }
        job=CreateJobObjectW(IntPtr.Zero, null); Need(job != IntPtr.Zero);
        ExtendedLimit limits=new ExtendedLimit(); limits.basic.flags=0x2000;
        Need(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit))));
        if (!interactive) {
        security.inherit=1;
        Need(CreatePipe(out outRead, out outWrite, ref security, 0)); Need(SetHandleInformation(outRead, 1, 0));
        Need(CreatePipe(out errRead, out errWrite, ref security, 0)); Need(SetHandleInformation(errRead, 1, 0));
        input=CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero); Need(input != new IntPtr(-1));
        }
        int attributeCount=interactive ? 1 : 2;
        IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
        attributes=Marshal.AllocHGlobal(size); Need(InitializeProcThreadAttributeList(attributes, attributeCount, 0, ref size)); initialized=true;
        if (!interactive) {
        handleList=Marshal.AllocHGlobal(IntPtr.Size*3); Marshal.WriteIntPtr(handleList, input); Marshal.WriteIntPtr(handleList, IntPtr.Size, outWrite); Marshal.WriteIntPtr(handleList, IntPtr.Size*2, errWrite);
        Need(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleList, new IntPtr(IntPtr.Size*3), IntPtr.Zero, IntPtr.Zero));
        }
        jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job);
        Need(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
        StartupEx startup=new StartupEx(); startup.attributes=attributes; startup.startup.size=Marshal.SizeOf(typeof(StartupEx));
        if (!interactive) { startup.startup.flags=0x180; startup.startup.input=input; startup.startup.output=outWrite; startup.startup.error=errWrite; }
        else { startup.startup.title="Agent Usage - official login / exit after sign-in"; }
        StringBuilder command=new StringBuilder(Quote(executable)); foreach(string argument in arguments) command.Append(' ').Append(Quote(argument));
        if (command.Length > 32766) throw new InvalidOperationException("JOB_REQUEST_INVALID");
        Array.Sort(environment, StringComparer.OrdinalIgnoreCase);
        environmentBlock=Marshal.StringToHGlobalUni(String.Join("\0", environment)+"\0\0");
        Need(WaitForSingleObject(parent, 0) == 258);
        if (cancellation.IsCompleted) { result.canceled=true; return result; }
        Need(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, !interactive, interactive ? 0x00080414u : 0x08080404u, environmentBlock, cwd, ref startup, out process)); created=true;
        long rootCreated,rootExit,rootKernel,rootUser; Need(GetProcessTimes(process.process,out rootCreated,out rootExit,out rootKernel,out rootUser));
        Close(ref outWrite); Close(ref errWrite); Close(ref input);
        IntPtr outputHandle=outRead, errorHandle=errRead;
        if (!interactive) { outputTask=Task.Factory.StartNew(() => capture.Read(outputHandle, capture.output, limit));
        errorTask=Task.Factory.StartNew(() => capture.Read(errorHandle, capture.error, limit)); }
        Need(ResumeThread(process.thread) != UInt32.MaxValue); Close(ref process.thread);
        Stopwatch clock=Stopwatch.StartNew();
        while (WaitForSingleObject(process.process, 20) == 258) {
          if (browser!=null) browser.Poll(job, executable, rootCreated, clock.ElapsedMilliseconds);
          if (WaitForSingleObject(parent, 0) != 258) { result.parentExited=true; break; }
          if (cancellation.IsCompleted) { result.canceled=true; break; }
          lock(capture.gate) { if (capture.overflow) { result.overflow=true; break; } }
          if (clock.ElapsedMilliseconds >= timeoutMs) { result.timedOut=true; break; }
        }
        uint exitCode; if (GetExitCodeProcess(process.process, out exitCode) && exitCode != 259) result.code=unchecked((int)exitCode);
        // Terminate even after normal root exit: surviving descendants belong
        // to this invocation and must not outlive it.
        Need(TerminateJobObject(job, 1));
        Stopwatch reap=Stopwatch.StartNew(); Accounting accounting;
        do { Need(QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); if (accounting.active == 0) break; Thread.Sleep(10); } while (reap.ElapsedMilliseconds < 3000);
        result.reaped=accounting.active == 0 && WaitForSingleObject(process.process, 3000) == 0;
        if (!interactive && !Task.WaitAll(new Task[]{outputTask,errorTask}, 3000)) result.reaped=false;
        lock(capture.gate) { result.overflow |= capture.overflow; result.stdout=Decode(capture.output.ToArray()); result.stderr=Decode(capture.error.ToArray()); }
      } catch (Exception error) {
        result.errorCode=error.Message == "JOB_BINARY_CHANGED" || error.Message == "JOB_REQUEST_INVALID" ? error.Message : "JOB_HOST_UNAVAILABLE";
      } finally {
        if (browser!=null) browser.Dispose();
        if (job != IntPtr.Zero) { TerminateJobObject(job, 1); Close(ref job); }
        if (!created) result.reaped=true;
        Close(ref process.thread); Close(ref process.process); Close(ref parent); Close(ref outWrite); Close(ref errWrite); Close(ref input);
        if (outputTask == null || outputTask.IsCompleted) Close(ref outRead);
        if (errorTask == null || errorTask.IsCompleted) Close(ref errRead);
        if (initialized) DeleteProcThreadAttributeList(attributes);
        foreach(IntPtr pointer in new IntPtr[]{attributes,handleList,jobList,environmentBlock}) if(pointer != IntPtr.Zero) Marshal.FreeHGlobal(pointer);
        if(pinned != null) pinned.Dispose(); foreach(IntPtr directory in directories) CloseHandle(directory);
      }
      return result;
    }
  }
}
