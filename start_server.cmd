@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem ---- This .cmd is ASCII-only on purpose. ----
rem cmd.exe parses batch files with the OEM code page (936 here), so UTF-8
rem Chinese text inside a .cmd gets mangled into bogus commands. All Chinese
rem output comes from the Python process instead (PYTHONIOENCODING=utf-8).

set "HF_HOME=D:\USERS\Desktop\Agent\model-cache\hf"
set "HF_HUB_OFFLINE=1"
set "PYTHONIOENCODING=utf-8"
set "PORT=8760"
set "PY=..\.venv\Scripts\python.exe"

if not exist "%PY%" (
  echo [ERROR] venv python not found: %PY%
  echo         Expected D:\USERS\Desktop\Agent\.venv
  pause
  exit /b 1
)

if not exist "data\embeddings.npy" (
  echo [ERROR] Index missing: data\embeddings.npy
  echo         Run first:  build_index.py --seq 140
  pause
  exit /b 1
)

echo ============================================================
echo   EmbeddingGemma 2  -  material library search
echo   Library : G:\model
echo   Open    : http://127.0.0.1:%PORT%/
echo   Stop    : Ctrl+C
echo ============================================================
echo.

"%PY%" server.py --port %PORT%

echo.
echo Server exited.
pause
