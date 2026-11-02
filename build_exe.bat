@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [情報] 先に依存パッケージをインストールします...
  call install.bat
)

echo [1/2] PyInstaller をインストールしています...
".venv\Scripts\python.exe" -m pip install --upgrade pyinstaller
if errorlevel 1 goto failed

echo [2/2] exe をビルドしています（1〜3 分ほど）...
rem --runtime-tmpdir . ：システムの一時フォルダではなく exe と同じ場所に展開します。
rem Temp がセキュリティソフトやグループポリシーで使えない環境でも起動できるようにするためです。
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
echo ビルド完了：dist\LiveSubLocal.exe
echo この exe を任意のフォルダにコピーしてダブルクリックすれば起動します（初回は api.toml を生成）。
pause
exit /b 0

:failed
echo.
echo [エラー] ビルドに失敗しました。上のメッセージを確認してください。
pause
exit /b 1
