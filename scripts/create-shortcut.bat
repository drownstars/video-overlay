@echo off
cd /d "%~dp0.."
set "PD=%CD%"

REM Create start.vbs
echo Set UAC = CreateObject("Shell.Application") > "%PD%\start.vbs"
echo UAC.ShellExecute "cmd", "/c cd /d %PD% && npx electron .", "", "runas", 0 >> "%PD%\start.vbs"

REM Create desktop shortcut with Chinese name
powershell -Command ^
  "$d=[Environment]::GetFolderPath('Desktop');" ^
  "$w=New-Object -ComObject WScript.Shell;" ^
  "$name=$d+'\' + [char]0x89C6 + [char]0x9891 + [char]0x5C0F + [char]0x7A97 + '.lnk';" ^
  "$s=$w.CreateShortcut($name);" ^
  "$s.TargetPath='wscript.exe';" ^
  "$s.Arguments='\"%PD:\=\\%\\start.vbs\"';" ^
  "$s.IconLocation='%PD:\=\\%\\resources\\icon.ico';" ^
  "$s.WorkingDirectory='%PD%';" ^
  "$s.Save();" ^
  "Write-Host 'Done:' $name"