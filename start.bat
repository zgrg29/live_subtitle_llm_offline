@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [提示] 还没有安装依赖，先运行 install.bat ...
  call install.bat
  if not exist ".venv\Scripts\python.exe" exit /b 1
)

if not exist "config.toml" (
  copy /y "config.example.toml" "config.toml" >nul
  echo [提示] 已生成 config.toml（一般不用改）。
)

if not exist "api.toml" (
  copy /y "api.example.toml" "api.toml" >nul
  echo [提示] 已生成 api.toml，请把千问 API Key 填进去。
  notepad "api.toml"
  echo [提示] 保存后重新双击 start.bat。
  pause
  exit /b 0
)

".venv\Scripts\python.exe" run.py
if errorlevel 1 pause
