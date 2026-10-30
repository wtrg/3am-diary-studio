' Khởi chạy 3AM Diary Studio ẩn console.
' Đây là launcher cho bản source local; installer thương mại sẽ thay đường dẫn electron.
Option Explicit
Dim fso, shell, project, electron
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
project = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
electron = project & "\node_modules\electron\dist\electron.exe"
If Not fso.FileExists(electron) Then
  MsgBox "Chưa cài Electron. Mở thư mục tool và chạy: npm install", 16, "3AM Diary Studio"
  WScript.Quit 1
End If
shell.CurrentDirectory = project
' Electron là GUI app nên không mở console; dùng style 1 để cửa sổ app hiện bình thường.
shell.Run """" & electron & """ .", 1, False
