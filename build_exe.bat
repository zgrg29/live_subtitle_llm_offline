@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [提示] 先安装依赖 ...
  call install.bat
)

echo [1/2] 安装 PyInstaller ...
".venv\Scripts\python.exe" -m pip install --upgrade pyinstaller
if errorlevel 1 goto failed

echo [2/2] 打包（大约 1-3 分钟）...
rem --runtime-tmpdir . ：解压到 exe 所在目录而不是系统临时目录，
rem 避免少数机器上 Temp 被安全软件/组策略锁住时报 "Could not create temporary directory"。
".venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean ^
  --onefile --console --name LiveSubLocal --runtime-tmpdir . ^
  --add-data "livesub_local\static;livesub_local\static" ^
  --add-data "config.example.toml;." ^
  --add-data "api.example.toml;." ^
  --collect-submodules uvicorn ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.lifespan.on ^
  run.py
if errorlevel 1 goto failed

echo.
echo 打包完成：dist\LiveSubLocal.exe
echo 把 LiveSubLocal.exe 拷到任意空文件夹，双击运行即可（第一次会生成 api.toml）。
pause
exit /b 0

:failed
echo.
echo [错误] 打包失败，请看上面的报错。
pause
exit /b 1
