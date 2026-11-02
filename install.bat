@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo [错误] 没有找到 python。
  echo 请先安装 Python 3.11 或更新版本，安装时勾选 "Add python.exe to PATH"。
  echo 下载地址：https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] 创建虚拟环境 .venv ...
  python -m venv .venv
  if errorlevel 1 (
    echo [错误] 创建虚拟环境失败。
    pause
    exit /b 1
  )
)

echo [2/2] 安装依赖（第一次会下载几十 MB）...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [错误] 依赖安装失败，请检查网络后重试。
  pause
  exit /b 1
)

echo.
echo 安装完成。接下来：
echo   1. 把 api.example.toml 复制成 api.toml，填入千问 API Key
echo   2. 双击 start.bat
pause
