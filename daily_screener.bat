@echo off
REM ============================================================
REM  Daily Screener (Local backup)
REM  - runs every weekday at 15:00 and 19:00 (Windows Task Scheduler)
REM  - flow: update_klines -> scrape_twii -> commit + push (deploy)
REM  - smart-skip: if cloud (GitHub Actions) already updated, this exits early
REM  - institutional / screener / Telegram are handled by cloud cron
REM ============================================================

cd /d "%~dp0"

set PYTHON=C:\Users\Derek\AppData\Local\Programs\Python\Python311\python.exe
set LOGFILE=%~dp0daily_screener.log

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

REM Pull latest first so we don't fight the cloud cron's commit
git pull --rebase >> "%LOGFILE%" 2>&1

REM Step 1: incremental K-line update (returns/turnovers/volumes/MA/etc.)
echo. >> "%LOGFILE%"
echo [1/3] update_klines... >> "%LOGFILE%"
"%PYTHON%" scripts/update_klines.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X update_klines failed >> "%LOGFILE%"
    "%PYTHON%" scripts/send_telegram.py "X daily_screener: update_klines.py failed" >> "%LOGFILE%" 2>&1
    exit /b 1
)

REM Step 2: TWII index
echo. >> "%LOGFILE%"
echo [2/3] scrape_twii... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_twii.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_twii failed (continuing) >> "%LOGFILE%"
)

REM Step 3: commit + push if data changed
echo. >> "%LOGFILE%"
echo [3/3] commit + push data updates... >> "%LOGFILE%"
git add frontend/public/data backend/db/twii.json >> "%LOGFILE%" 2>&1

git diff --cached --quiet
if not errorlevel 1 (
    echo No data changes (cloud already updated), skipping commit/push >> "%LOGFILE%"
    echo Run finished: %date% %time% >> "%LOGFILE%"
    exit /b 0
)

git commit -m "data: local backup auto-update" >> "%LOGFILE%" 2>&1
git push >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X push failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo Done! >> "%LOGFILE%"
echo Run finished: %date% %time% >> "%LOGFILE%"
exit /b 0
