@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [情報] 依存パッケージが未インストールです。install.bat を実行します...
  call install.bat
  if not exist ".venv\Scripts\python.exe" exit /b 1
)

if not exist "config.toml" (
  copy /y "config.example.toml" "config.toml" >nul
  echo [情報] config.toml を作成しました（通常は変更不要です）。
)

if not exist "api.toml" (
  copy /y "api.example.toml" "api.toml" >nul
  echo [情報] api.toml を作成しました。Qwen の API キーを入力してください。
  notepad "api.toml"
  echo [情報] 保存したら、start.bat をもう一度実行してください。
  pause
  exit /b 0
)

".venv\Scripts\python.exe" run.py
if errorlevel 1 pause
