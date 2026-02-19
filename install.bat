@echo off
setlocal

set SCRIPT_DIR=%~dp0
set DB_PATH=%USERPROFILE%\.daily-accomplishments\accomplishments.db

echo Installing Python dependencies...
pip install -r "%SCRIPT_DIR%requirements.txt"
if errorlevel 1 (
    echo ERROR: pip install failed. Make sure Python 3.10+ is installed and on your PATH.
    exit /b 1
)

echo Registering MCP server with Claude...
claude mcp add daily-accomplishments --scope user -e ACCOMPLISHMENTS_DB="%DB_PATH%" -- python "%SCRIPT_DIR%server.py"
if errorlevel 1 (
    echo ERROR: Failed to register MCP. Make sure Claude Code is installed.
    exit /b 1
)

echo.
echo Done! The MCP server is registered as 'daily-accomplishments'.
echo.
echo   Database: %DB_PATH%
echo   Dashboard: http://localhost:8765 (active during Claude sessions)
echo.
echo Usage:
echo   At the end of any Claude session, say:
echo   "Log today's accomplishments"
echo.
echo   For annual review: "Summarize my accomplishments this year"
echo.
echo   To move your database to a different location, use the
echo   Export / Import buttons in the web dashboard.
