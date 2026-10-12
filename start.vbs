Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "cmd", "/c cd /d D:\video-overlay && npx electron .", "", "runas", 0
