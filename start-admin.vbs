Set fso = CreateObject("Scripting.FileSystemObject")
Set shellEnv = CreateObject("WScript.Shell")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
batPath = fso.BuildPath(appDir, "start.bat")
cmdPath = shellEnv.ExpandEnvironmentStrings("%ComSpec%")

If Not fso.FileExists(batPath) Then
    MsgBox "Startup script was not found:" & vbCrLf & batPath, vbCritical, "Video Overlay"
    WScript.Quit 1
End If

If Not fso.FileExists(cmdPath) Then
    MsgBox "Command interpreter was not found:" & vbCrLf & cmdPath, vbCritical, "Video Overlay"
    WScript.Quit 1
End If

Set shell = CreateObject("Shell.Application")
arguments = "/d /c " & Chr(34) & Chr(34) & batPath & Chr(34) & Chr(34)
shell.ShellExecute cmdPath, arguments, appDir, "runas", 0
