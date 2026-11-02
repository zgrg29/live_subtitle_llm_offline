@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo [エラー] python が見つかりません。
  echo Python 3.11 以降をインストールし、セットアップ時に "Add python.exe to PATH" にチェックを入れてください。
  echo ダウンロード：https://www.python.org/downloads/
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/2] 仮想環境 .venv を作成しています...
  python -m venv .venv
  if errorlevel 1 (
    echo [エラー] 仮想環境の作成に失敗しました。
    pause
    exit /b 1
  )
)

echo [2/2] 依存パッケージをインストールしています（初回は数十 MB のダウンロードがあります）...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo [エラー] インストールに失敗しました。ネットワークを確認して再実行してください。
  pause
  exit /b 1
)

echo.
echo インストールが完了しました。次に：
echo   1. api.example.toml を api.toml にコピーし、Qwen の API キーを入力
echo   2. start.bat を実行
pause
