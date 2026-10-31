' Mở app và cửa sổ đăng nhập Muse thật.
' Người dùng tự đăng nhập; script không đọc/lưu tài khoản.
Option Explicit
Dim fso, shell, project, electron
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
project = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
electron = project & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  MsgBox "Chưa cài Electron. Mở thư mục tool và chạy: npm install", 16, "3AM Muse Login"
  WScript.Quit 1
End If
shell.CurrentDirectory = project
shell.Run """" & electron & """ . --muse-login", 1, False
