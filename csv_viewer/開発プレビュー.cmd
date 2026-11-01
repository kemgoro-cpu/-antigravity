@echo off
setlocal
title CSV Chart Viewer - Development Preview
cd /d "%~dp0"
set "CSV_PREVIEW_NODE="
for /f "delims=" %%N in ('where node.exe 2^>nul') do if not defined CSV_PREVIEW_NODE set "CSV_PREVIEW_NODE=%%N"
if defined CSV_PREVIEW_NODE (
    "%CSV_PREVIEW_NODE%" -e "process.exit(Math.sign(Number(process.versions.node.split('.')[0])-18) === -1 ? 1 : 0)" >nul 2>&1
    if errorlevel 1 set "CSV_PREVIEW_NODE="
)
if not defined CSV_PREVIEW_NODE if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" set "CSV_PREVIEW_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not defined CSV_PREVIEW_NODE (
    echo Node.js was not found. Install Node.js 18 or later, or run this from the Codex environment.
    pause
    exit /b 1
)
echo Starting the local development preview. Keep this window open.
echo Press Ctrl+C to stop the server. The regular index.html still works without it.
"%CSV_PREVIEW_NODE%" "%~dp0scripts\dev-server.js" --open
set "CSV_PREVIEW_EXIT=%errorlevel%"
if not "%CSV_PREVIEW_EXIT%"=="0" pause
exit /b %CSV_PREVIEW_EXIT%
