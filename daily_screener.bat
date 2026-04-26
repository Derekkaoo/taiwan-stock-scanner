@echo off
REM ============================================================
REM  Daily Screener
REM  - runs every weekday 19:00 (Windows Task Scheduler)
REM  - flow: update_klines -> scrape_twii -> scrape_institutional
REM         -> run screeners (Telegram) -> commit + push (deploy)
REM ============================================================

cd /d "%~dp0"

set PYTHON=C:\Users\Derek\AppData\Local\Programs\Python\Python311\python.exe
set LOGFILE=%~dp0daily_screener.log

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

REM Step 1: incremental K-line update (returns/turnovers/volumes/MA/etc.)
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
    echo X scrape_twii failed (continuing without TWII) >> "%LOGFILE%"
)

REM Step 3: institutional investors (foreign / trust / dealer)
echo. >> "%LOGFILE%"
echo [3/5] scrape_institutional... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_institutional.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_institutional failed (continuing without institutional data) >> "%LOGFILE%"
)

REM Step 4: run screeners + push Telegram
echo. >> "%LOGFILE%"
echo [4/5] run screeners... >> "%LOGFILE%"
"%PYTHON%" -m scripts.screeners.runner >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X screener runner failed >> "%LOGFILE%"
    exit /b 1
)

REM Step 5: commit + push data updates so the website also gets fresh data
echo. >> "%LOGFILE%"
echo [5/5] commit + push data updates... >> "%LOGFILE%"
git add frontend/public/data backend/db/twii.json backend/db/institutional.json >> "%LOGFILE%" 2>&1

REM skip commit if no actual data change
git diff --cached --quiet
if not errorlevel 1 (
    echo No data changes, skipping commit/push >> "%LOGFILE%"
    echo Run finished: %date% %time% >> "%LOGFILE%"
    exit /b 0
)

git commit -m "data: daily auto-update" >> "%LOGFILE%" 2>&1
git push >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X push failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo Done! CI will deploy in ~5 min >> "%LOGFILE%"
echo Run finished: %date% %time% >> "%LOGFILE%"
exit /b 0
