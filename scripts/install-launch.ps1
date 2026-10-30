$ErrorActionPreference = "Stop"
$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electron = Join-Path $project "node_modules\electron\dist\electron.exe"
$launch = Join-Path $project "scripts\launch.vbs"
$wscript = Join-Path $env:WINDIR "System32\wscript.exe"

if (-not (Test-Path $electron)) { throw "Chưa cài Electron. Chạy npm install trong $project" }
if (-not (Test-Path $launch)) { throw "Thiếu scripts\launch.vbs" }

$binDir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$wrapper = Join-Path $binDir "3am-diary-studio.cmd"
$wrapperContent = "@echo off`r`nwscript `"$launch`"`r`n"
Set-Content -Path $wrapper -Value $wrapperContent -Encoding ASCII
Write-Host "PATH wrapper: $wrapper"

$desktop = [Environment]::GetFolderPath('Desktop')
$desktopShortcut = Join-Path $desktop "3AM Diary Studio.lnk"
$programs = [Environment]::GetFolderPath('Programs')
$startMenuShortcut = Join-Path $programs "3AM Diary Studio.lnk"

$shell = New-Object -ComObject WScript.Shell
foreach ($shortcutPath in @($desktopShortcut, $startMenuShortcut)) {
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $wscript
  $shortcut.Arguments = "`"$launch`""
  $shortcut.WorkingDirectory = $project
  $shortcut.IconLocation = "$electron,0"
  $shortcut.Description = "3AM Diary Studio - tool video local"
  $shortcut.Save()
  Write-Host "Shortcut: $shortcutPath"
}

Write-Host ""
Write-Host "Installed launch paths:"
Write-Host "  - Command: 3am-diary-studio"
Write-Host "  - Desktop: 3AM Diary Studio"
Write-Host "  - Start Menu: 3AM Diary Studio"
