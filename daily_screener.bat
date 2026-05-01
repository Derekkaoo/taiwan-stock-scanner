@echo off
REM ============================================================
REM  Daily Screener (Local FULL pipeline backup)
REM  - runs every weekday at 15:00 and 19:00 (Windows Task Scheduler)
REM  - flow: pull -> klines -> twii -> institutional -> screener -> commit/push
REM  - Telegram dedup is built-in (won't double-push with cloud)
REM  - smart-skip everywhere; safe to re-run
REM ============================================================

cd /d "%~dp0"

set PYTHON=C:\Users\Derek\AppData\Local\Programs\Python\Python311\python.exe
set LOGFILE=%~dp0daily_screener.log

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

REM Pull latest first so we don't fight cloud cron commits
git pull --rebase >> "%LOGFILE%" 2>&1

REM Step 1: incremental K-line update
echo. >> "%LOGFILE%"
echo [1/5] update_klines... >> "%LOGFILE%"
"%PYTHON%" scripts/update_klines.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X update_klines failed >> "%LOGFILE%"
    "%PYTHON%" scripts/send_telegram.py "X daily_screener: update_klines.py failed" >> "%LOGFILE%" 2>&1
    exit /b 1
)

REM Step 2: TWII index
echo. >> "%LOGFILE%"
echo [2/5] scrape_twii... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_twii.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_twii failed (continuing) >> "%LOGFILE%"
)

REM Step 3: institutional buy/sell + buy streak
echo. >> "%LOGFILE%"
echo [3/5] scrape_institutional... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_institutional.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_institutional failed (continuing) >> "%LOGFILE%"
)

REM Step 4: run screeners + push Telegram (dedup against cloud via hash)
echo. >> "%LOGFILE%"
echo [4/5] screeners + telegram... >> "%LOGFILE%"
"%PYTHON%" -m scripts.screeners.runner >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X screener runner failed (continuing) >> "%LOGFILE%"
)

REM Step 5: commit + push if data changed (triggers cloud deploy via push trigger)
echo. >> "%LOGFILE%"
echo [5/5] commit + push data updates... >> "%LOGFILE%"
git add frontend/public/data backend/db/twii.json backend/db/institutional.json backend/db/last_telegram_push.json >> "%LOGFILE%" 2>&1

git diff --cached --quiet
if not errorlevel 1 (
    echo No data changes ^(cloud already updated^), skipping commit/push >> "%LOGFILE%"
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
