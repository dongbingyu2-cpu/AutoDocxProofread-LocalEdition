param([int]$TargetProcessId, [string]$FilePath, [string]$DialogKind = 'save')
$DialogTitle = if ($DialogKind -eq 'open') { '选择 DOCX 文件' } else { '导出修正后的 DOCX 文件' }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
# 部分 Windows 版本由系统代理展示文件对话框，进程过滤无法命中；回退固定标题的 Win32 对话框。
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ProofSaveDialog {
  public delegate bool Callback(IntPtr hwnd, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hwnd, StringBuilder name, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hwnd, uint message, IntPtr value, string text);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr value, IntPtr other);
}
'@
$processCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetProcessId)
$idCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1001')
$editCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
$saveCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1')
for ($attempt = 0; $attempt -lt 80; $attempt++) {
  $dialog = [ProofSaveDialog]::FindWindow('#32770', $DialogTitle)
  if ($dialog -ne [IntPtr]::Zero) {
    if ($DialogKind -eq 'open') {
      # 文件名输入通过原生快捷键触发完整输入事件，兼容不同 Common Item Dialog 控件树。
      [ProofSaveDialog]::SetForegroundWindow($dialog) | Out-Null
      Start-Sleep -Milliseconds 150
      if ([ProofSaveDialog]::GetForegroundWindow() -eq $dialog) {
        [System.Windows.Forms.SendKeys]::SendWait('%n')
        [System.Windows.Forms.SendKeys]::SendWait('^a')
        [System.Windows.Forms.SendKeys]::SendWait($FilePath)
        [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
        for ($closedAttempt=0; $closedAttempt -lt 25; $closedAttempt++) {
          Start-Sleep -Milliseconds 100
          if ([ProofSaveDialog]::FindWindow('#32770', $DialogTitle) -eq [IntPtr]::Zero) { Write-Output 'Native Open dialog completed.'; exit 0 }
        }
      }
    }
    $script:filenameControl = [IntPtr]::Zero
    $callback = [ProofSaveDialog+Callback] {
      param([IntPtr]$control, [IntPtr]$unused)
      $name = New-Object Text.StringBuilder 128
      [ProofSaveDialog]::GetClassName($control, $name, 128) | Out-Null
      $id = [ProofSaveDialog]::GetDlgCtrlID($control)
      if ($name.ToString() -eq 'Edit' -and $id -in @(1001,1152,1148)) {
        $parent = [ProofSaveDialog]::GetParent($control)
        for ($depth=0; $depth -lt 4 -and $parent -ne [IntPtr]::Zero; $depth++) {
          if ([ProofSaveDialog]::GetDlgCtrlID($parent) -eq 1148) { $script:filenameControl = $control; return $false }
          $parent = [ProofSaveDialog]::GetParent($parent)
        }
        if ($script:filenameControl -eq [IntPtr]::Zero) { $script:filenameControl = $control }
      }
      return $true
    }
    [ProofSaveDialog]::EnumChildWindows($dialog, $callback, [IntPtr]::Zero) | Out-Null
    if ($script:filenameControl -ne [IntPtr]::Zero) {
      [ProofSaveDialog]::SendMessage($script:filenameControl, 12, [IntPtr]::Zero, $FilePath) | Out-Null
      [ProofSaveDialog]::PostMessage($dialog, 273, [IntPtr]1, [IntPtr]::Zero) | Out-Null
      for ($closedAttempt=0; $closedAttempt -lt 25; $closedAttempt++) {
        Start-Sleep -Milliseconds 100
        if ([ProofSaveDialog]::FindWindow('#32770', $DialogTitle) -eq [IntPtr]::Zero) { Write-Output 'Native file dialog completed through Win32.'; exit 0 }
      }
    }
  }
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $processCondition)
  foreach ($window in $windows) {
    $field = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
    if (-not $field) { continue }
    if ($field.Current.ControlType -ne [System.Windows.Automation.ControlType]::Edit) {
      $field = $field.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
    }
    if (-not $field) { continue }
    $value = $field.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $value.SetValue($FilePath)
    $button = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $saveCondition)
    if (-not $button) { continue }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    Write-Output 'Native Save dialog accepted.'
    exit 0
  }
  Start-Sleep -Milliseconds 150
}
Write-Output ('Target dialog kind: ' + $DialogKind + '; process windows: ' + $windows.Count)
foreach ($window in $windows) { Write-Output ('Target window: ' + $window.Current.Name + '; class: ' + $window.Current.ClassName) }
throw 'Native file dialog not found for the test application.'
