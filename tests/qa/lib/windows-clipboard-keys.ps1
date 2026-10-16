$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$owned = Get-Process -Id $env:AMORIST_QA_APP_PID -ErrorAction Stop
if ($owned.Path -ne $env:AMORIST_QA_APPLICATION -or $owned.SessionId -ne (Get-Process -Id $PID).SessionId) {
  throw 'Owned application identity mismatch'
}
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AmoristClipboardFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint from, uint to, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr window);
  public static void Activate(IntPtr window) {
    if (GetForegroundWindow() == window) return;
    uint ignored;
    uint current = GetCurrentThreadId();
    uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
    uint target = GetWindowThreadProcessId(window, out ignored);
    bool attachedForeground = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
    bool attachedTarget = target != 0 && target != current && target != foreground && AttachThreadInput(current, target, true);
    try {
      BringWindowToTop(window);
      SetForegroundWindow(window);
    } finally {
      if (attachedTarget) AttachThreadInput(current, target, false);
      if (attachedForeground) AttachThreadInput(current, foreground, false);
    }
  }
}
'@
$end = [DateTime]::UtcNow.AddSeconds(3)
[uint32]$foreground = 0
do {
  $owned.Refresh()
  if ($owned.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Owned application has no native window' }
  [AmoristClipboardFocus]::Activate($owned.MainWindowHandle)
  [void][AmoristClipboardFocus]::GetWindowThreadProcessId([AmoristClipboardFocus]::GetForegroundWindow(), [ref]$foreground)
  if ($foreground -ne $owned.Id) { Start-Sleep -Milliseconds 50 }
} while ($foreground -ne $owned.Id -and [DateTime]::UtcNow -lt $end)
if ($foreground -ne $owned.Id) { throw 'Owned application not foreground; keyboard input refused' }
if ($env:AMORIST_QA_CHORD) {
  [System.Windows.Forms.SendKeys]::SendWait($env:AMORIST_QA_CHORD)
}
