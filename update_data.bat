@echo off
REM Weekly stock data update script (auto mode for Task Scheduler)
REM Output log: update_data.log in same folder

cd /d "%~dp0"

set PYTHON=C:\Users\Derek\AppData\Local\Programs\Python\Python311\python.exe
set LOGFILE=%~dp0update_data.log

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

echo [1/4] git pull... >> "%LOGFILE%" 2>&1
git pull >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X git pull failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo [2/4] Run pipeline (5~10 min)... >> "%LOGFILE%"
"%PYTHON%" scripts/run_pipeline.py --force >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X pipeline failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo [3/4] Check changes... >> "%LOGFILE%"
git status --short frontend/public/data backend/db/*.json >> "%LOGFILE%" 2>&1

REM Skip commit if no changes
git diff --quiet frontend/public/data backend/db/*.json
if not errorlevel 1 (
    echo. >> "%LOGFILE%"
    echo No data changes, skipping commit/push >> "%LOGFILE%"
    echo Run finished: %date% %time% >> "%LOGFILE%"
    exit /b 0
)

echo. >> "%LOGFILE%"
echo [4/4] commit + push... >> "%LOGFILE%"
git add frontend/public/data >> "%LOGFILE%" 2>&1
git add backend/db/*.json >> "%LOGFILE%" 2>&1
git commit -m "data: weekly auto-update" >> "%LOGFILE%" 2>&1
git push >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X push failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo Done! CI will deploy in ~5 min >> "%LOGFILE%"
echo Run finished: %date% %time% >> "%LOGFILE%"
exit /b 0
