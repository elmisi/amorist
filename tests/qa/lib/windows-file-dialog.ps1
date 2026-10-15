$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$qaPid=[int]$env:AMORIST_QA_DIALOG_PID
$qaProcess=Get-Process -Id $qaPid
if($qaProcess.Path -ne $env:AMORIST_QA_APPLICATION -or $qaProcess.SessionId -ne (Get-Process -Id $PID).SessionId){throw 'Dialog process is not the owned application in this session'}
$qaCondition=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$qaPid)
if($env:AMORIST_QA_DIALOG_ACTION -eq 'inspect'){
  $qaOwned=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$qaCondition)
  $qaSnapshot=@()
  foreach($qaWindow in $qaOwned){
    $qaNodes=$qaWindow.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
    foreach($qaNode in $qaNodes){
      if($qaNode.Current.ClassName -eq '#32770' -or $qaNode.Current.ControlType -eq [Windows.Automation.ControlType]::Button){$qaSnapshot+=[pscustomobject]@{type=$qaNode.Current.ControlType.ProgrammaticName;id=$qaNode.Current.AutomationId;name=$qaNode.Current.Name;class=$qaNode.Current.ClassName}}
    }
  }
  $qaSnapshot | ConvertTo-Json -Compress
  exit
}
$qaDeadline=[DateTime]::UtcNow.AddSeconds(10)
$qaDialog=$null
while(!$qaDialog -and [DateTime]::UtcNow -lt $qaDeadline){
  $qaWindows=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,$qaCondition)
  foreach($qaWindow in $qaWindows){
    if($qaWindow.Current.ClassName -eq '#32770'){$qaDialog=$qaWindow;break}
    $qaClass=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'#32770')
    $qaNested=$qaWindow.FindFirst([Windows.Automation.TreeScope]::Descendants,$qaClass)
    if($qaNested -and $qaNested.Current.ProcessId -eq $qaPid){$qaDialog=$qaNested;break}
  }
  if(!$qaDialog){Start-Sleep -Milliseconds 50}
}
if(!$qaDialog){
  $qaOwned=$qaWindows | ForEach-Object {[pscustomobject]@{class=$_.Current.ClassName;controlType=$_.Current.ControlType.ProgrammaticName;pid=$_.Current.ProcessId}}
  throw ('Owned native file dialog was not found; owned top-level controls: '+($qaOwned | ConvertTo-Json -Compress))
}
$qaTitle=$qaDialog.Current.Name
if($env:AMORIST_QA_DIALOG_ACTION -eq 'accept'){
  $qaPath=[IO.Path]::GetFullPath($env:AMORIST_QA_DIALOG_PATH)
  $qaRoot=[IO.Path]::GetFullPath($env:AMORIST_QA_DIALOG_ROOT).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
  if(!$qaPath.StartsWith($qaRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing a path outside the private fixture directory'}
  $qaButtonId='1'
}elseif($env:AMORIST_QA_DIALOG_ACTION -eq 'cancel'){$qaButtonId='2'}else{throw 'Unknown file dialog operation'}
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class AmoristDialogWindow { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h); [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }'
$qaHandle=[IntPtr]$qaDialog.Current.NativeWindowHandle
[uint32]$qaHandlePid=0
[void][AmoristDialogWindow]::GetWindowThreadProcessId($qaHandle,[ref]$qaHandlePid)
if($qaHandle -eq [IntPtr]::Zero -or $qaHandlePid -ne $qaPid){throw 'Native dialog handle is not owned by the application'}
if($env:AMORIST_QA_DIALOG_ACTION -eq 'cancel'){
  if(![AmoristDialogWindow]::PostMessage($qaHandle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)){throw 'Native dialog close request failed'}
}else{
  # The VM uses the Italian common dialog; Alt+N focuses "Nome file".
  if((Get-Culture).TwoLetterISOLanguageName -notin @('it','en')){throw 'Filename mnemonic has not been verified in this locale'}
  Add-Type -AssemblyName System.Windows.Forms
  [void][AmoristDialogWindow]::SetForegroundWindow($qaHandle)
  Start-Sleep -Milliseconds 100
  if([AmoristDialogWindow]::GetForegroundWindow() -ne $qaHandle){throw 'Owned native dialog is not foreground; refusing keyboard input'}
  [Windows.Forms.SendKeys]::SendWait('%n')
  [Windows.Forms.SendKeys]::SendWait('^a')
  $qaKeys=[regex]::Replace($qaPath,'[+^%~(){}\[\]]',{param($m) '{'+$m.Value+'}'})
  [Windows.Forms.SendKeys]::SendWait($qaKeys)
  [Windows.Forms.SendKeys]::SendWait('{ENTER}')
}
[pscustomobject]@{native=$true;title=$qaTitle;action=$env:AMORIST_QA_DIALOG_ACTION;ownedPid=$qaPid} | ConvertTo-Json -Compress
