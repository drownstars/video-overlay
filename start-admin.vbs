Set UAC = CreateObject("Shell.Application")
UAC.ShellExecute "D:\video-overlay\start.bat", "", "", "runas", 1
