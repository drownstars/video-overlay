$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $projectDir

$desktop = [Environment]::GetFolderPath("Desktop")
$name = [char]0x89C6 + [char]0x9891 + [char]0x5C0F + [char]0x7A97
$shortcutPath = Join-Path $desktop "$name.lnk"
$vbsPath = Join-Path $projectDir "start.vbs"
$iconPath = Join-Path $projectDir "resources/icon.ico"

# Create start.vbs
Set-Content -Path $vbsPath -Encoding Default -Value @"
Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "cmd", "/c cd /d $projectDir && npx electron .", "", "runas", 0
"@

# Create shortcut
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$vbsPath`""
$Shortcut.IconLocation = $iconPath
$Shortcut.WorkingDirectory = $projectDir
$Shortcut.Save()

Write-Host "Done: $shortcutPath"