# 创建桌面快捷方式（版控可移植版）
# 快捷方式直接指向 start-admin.vbs：该脚本用 fso 定位自身所在目录，
# 从而在项目移动后仍能正确指向 start.bat 并以管理员权限启动。
# 不再动态生成 start.vbs（避免在生成物中硬编码本机绝对路径）。

$projectDir = Split-Path -Parent $PSScriptRoot

$desktop = [Environment]::GetFolderPath("Desktop")
$name = [char]0x89C6 + [char]0x9891 + [char]0x5C0F + [char]0x7A97
$shortcutPath = Join-Path $desktop "$name.lnk"
$vbsPath = Join-Path $projectDir "start-admin.vbs"
$iconPath = Join-Path $projectDir "resources/icon.ico"

if (-not (Test-Path $vbsPath)) {
    Write-Error "找不到启动脚本: $vbsPath"
    exit 1
}

# Create shortcut -> wscript.exe start-admin.vbs
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($shortcutPath)
$Shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$Shortcut.Arguments = "`"$vbsPath`""
$Shortcut.IconLocation = $iconPath
$Shortcut.WorkingDirectory = $projectDir
$Shortcut.Save()

Write-Host "Done: $shortcutPath -> wscript.exe $vbsPath"
