Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "cmd", "/c cd /d D:\nuann\video-overlay && npx electron .", "", "runas", 0
