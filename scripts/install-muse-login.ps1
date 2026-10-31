$ErrorActionPreference = "Stop"
$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $project "node_modules\electron\dist\electron.exe"
$launch = Join-Path $project "scripts\muse-login.vbs"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"

if (-not (Test-Path $electron)) { throw "Chưa cài Electron. Chạy npm install trong $project" }
if (-not (Test-Path $launch)) { throw "Thiếu scripts\muse-login.vbs" }

$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')
$targets = @(
  (Join-Path $desktop "3AM Muse Login.lnk"),
  (Join-Path $programs "3AM Muse Login.lnk")
)
$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in $targets) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $wscript
  $shortcut.Arguments = "`"$launch`""
  $shortcut.WorkingDirectory = $project
  $shortcut.IconLocation = "$electron,0"
  $shortcut.Description = "Mở 3AM Diary Studio và cửa sổ đăng nhập Muse"
  $shortcut.Save()
  Write-Host "Shortcut: $shortcutPath"
}
Write-Host "Dùng shortcut '3AM Muse Login' để mở app + cửa sổ đăng nhập Muse thật."
