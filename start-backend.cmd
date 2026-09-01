@echo off
setlocal
set "PROJECT_DIR=%~dp0"
set "PYTHON_EXE=%PROJECT_DIR%.python\python.exe"

if not exist "%PYTHON_EXE%" (
  echo Project Python was not found at "%PYTHON_EXE%".
  echo Reinstall the local Python runtime before starting the backend.
  exit /b 1
)

pushd "%PROJECT_DIR%Backend"
echo Starting OPD backend at http://127.0.0.1:8000
"%PYTHON_EXE%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
