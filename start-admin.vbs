Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute appDir & "\start.bat", "", "", "runas", 1