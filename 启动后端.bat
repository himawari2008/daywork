@echo off
REM ============================================
REM  活记后端一键启动 (daywork/server, port 3000)
REM  双击运行 · 窗口开着 = 后端活着 · 关窗口 = 停服务
REM  带参数 dev 则以源码热更新模式启动: 启动后端.bat dev
REM ============================================
chcp 65001 >nul
title 活记后端 :3000
set "PATH=D:\Program Files\nodejs;%PATH%"

REM 已在监听则不重复启动
netstat -ano | findstr "LISTENING" | findstr ":3000 " >nul
if %errorlevel%==0 (
  echo [OK] 3000 端口已有服务在跑，无需重复启动。
  timeout /t 5 >nul
  exit /b 0
)

REM 检查 PostgreSQL
netstat -ano | findstr "LISTENING" | findstr ":5432 " >nul
if not %errorlevel%==0 (
  echo [警告] PostgreSQL 5432 未监听，请先启动数据库！
  pause
  exit /b 1
)

cd /d "%~dp0server"
if "%1"=="dev" (
  echo [启动] 热更新模式 npm run start:dev ...
  call npm.cmd run start:dev
) else (
  echo [启动] node dist\main.js  ^(改了后端源码需先 npm run build^)
  node dist\main.js
)

echo.
echo [退出] 服务已停止。按任意键关闭窗口...
pause >nul
