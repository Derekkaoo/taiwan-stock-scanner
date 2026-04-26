@echo off
REM ============================================================
REM  Daily Screener
REM  - 每日 19:00 跑（Windows Task Scheduler）
REM  - 流程：增量更新 K 線 → 抓 TWII → 跑策略 → 發 Telegram
REM ============================================================

cd /d "%~dp0"

set PYTHON=C:\Users\Derek\AppData\Local\Programs\Python\Python311\python.exe
set LOGFILE=%~dp0daily_screener.log

echo. >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"
echo Run started: %date% %time% >> "%LOGFILE%"
echo ======================================== >> "%LOGFILE%"

REM ── 1. 增量更新 K 線（含 returns / turnovers / volumes / pctOf52wHigh / 200d / MA / dailyChange）
echo. >> "%LOGFILE%"
echo [1/4] update_klines... >> "%LOGFILE%"
"%PYTHON%" scripts/update_klines.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X update_klines failed >> "%LOGFILE%"
    "%PYTHON%" scripts/send_telegram.py "X daily_screener: update_klines.py failed" >> "%LOGFILE%" 2>&1
    exit /b 1
)

REM ── 2. 抓 TWII 大盤
echo. >> "%LOGFILE%"
echo [2/4] scrape_twii... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_twii.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_twii failed (continuing without TWII) >> "%LOGFILE%"
)

REM ── 3. 抓三大法人買賣超（給選股 2 用）
echo. >> "%LOGFILE%"
echo [3/4] scrape_institutional... >> "%LOGFILE%"
"%PYTHON%" scripts/scrape_institutional.py >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X scrape_institutional failed (continuing without institutional data) >> "%LOGFILE%"
)

REM ── 4. 跑 screener + 發 Telegram
echo. >> "%LOGFILE%"
echo [4/4] run screeners... >> "%LOGFILE%"
"%PYTHON%" -m scripts.screeners.runner >> "%LOGFILE%" 2>&1
if errorlevel 1 (
    echo X screener runner failed >> "%LOGFILE%"
    exit /b 1
)

echo. >> "%LOGFILE%"
echo Done! >> "%LOGFILE%"
echo Run finished: %date% %time% >> "%LOGFILE%"
exit /b 0
