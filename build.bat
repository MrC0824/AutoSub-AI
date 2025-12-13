@echo off
chcp 65001 >nul 2>&1
<nul set /p "=﻿"
setlocal enabledelayedexpansion
title AutoSub AI 一键打包
cd /d "%~dp0"
cls

:MainExecution
echo.
echo ===================================================
echo                AutoSub AI 一键打包
echo ===================================================
echo.

REM =========================================================================
REM [Step 1] 配置依赖策略 (.npmrc)
REM =========================================================================
call :Print " [1/4] 正在检查 .npmrc 配置..."
if not exist .npmrc (
    echo shamefully-hoist=true> .npmrc
    call :Print "    └─ 已创建配置：开启依赖扁平化"
) else (
    findstr "shamefully-hoist=true" .npmrc
    if !errorlevel! neq 0 (
        echo shamefully-hoist=true>> .npmrc
        call :Print "    └─ 已更新配置：开启依赖扁平化"
) else (
        call :Print "    └─ 配置检查通过"
)
)

REM =========================================================================
REM [Step 2] 环境清理
REM =========================================================================
call :Print " [2/4] 正在清理进程与缓存..."
taskkill /F /IM "AutoSub*" /T
timeout /t 2 /nobreak >nul

set "CLEANED=0"
if exist dist (rd /s /q dist & set "CLEANED=1")
if exist release (rd /s /q release & set "CLEANED=1")
if exist .vite (rd /s /q .vite & set "CLEANED=1")
if exist .tsbuildinfo (del /f /q .tsbuildinfo & set "CLEANED=1")

if "%CLEANED%"=="1" (
    call :Print "    └─ 清理完成"
) else (
    call :Print "    └─ 无需清理"
)

REM =========================================================================
REM [Step 3] 依赖检查与安装
REM =========================================================================
call :Print " [3/4] 正在校验项目依赖..."

if exist node_modules (
    call :Print "    └─ 检测到依赖已存在，跳过安装"
    goto :CheckIntegrity
)

:InstallDeps
echo     └─ [安装] 正在安装依赖...
call pnpm install

    if !errorlevel! equ 0 (
    call :Print "    └─ 依赖安装完成"
    ) else (
    call :Print "    └─ 依赖安装微调中..."
    )

:CheckIntegrity
REM 核心工具查漏补缺
set "MISSING_DEPS="
if not exist "node_modules\typescript\package.json" set "MISSING_DEPS=!MISSING_DEPS! typescript"
if not exist "node_modules\vite\package.json" set "MISSING_DEPS=!MISSING_DEPS! vite"
if not exist "node_modules\esbuild\package.json" set "MISSING_DEPS=!MISSING_DEPS! esbuild"
if not exist "node_modules\electron-updater\package.json" set "MISSING_DEPS=!MISSING_DEPS! electron-updater"
if not exist "node_modules\builder-util-runtime\package.json" set "MISSING_DEPS=!MISSING_DEPS! builder-util-runtime"

if not "!MISSING_DEPS!"=="" (
    call :Print "    └─ 正在补全缺失工具: !MISSING_DEPS!"
    call pnpm add !MISSING_DEPS! --registry=https://registry.npmmirror.com
    call :Print "    └─ 工具补全完成"
) else (
    call :Print "    └─ 依赖完整性检查通过"
)

echo.
call :Print " 准备就绪，即将开始打包..."
timeout /t 2 /nobreak >nul

REM =========================================================================
REM [Step 4] 执行打包
REM =========================================================================
echo.
call :Print " [4/4] 正在构建 (pnpm run electron:build)..."
echo.

set "start_ticks=0"
for /f "usebackq tokens=*" %%a in (`powershell -command "(Get-Date).Ticks"`) do set "start_ticks=%%a"
for /f "usebackq tokens=*" %%t in (`powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "start_tm=%%t"

set "PACK_OK=0"
call pnpm run electron:build
if !errorlevel! equ 0 set "PACK_OK=1"

REM =========================================================================
REM [Step 5] 结束统计
REM =========================================================================
set "duration=00 分 00 秒"
if not "%start_ticks%"=="0" (
    for /f "usebackq tokens=*" %%a in (`powershell -command "$ts=[TimeSpan]::FromTicks((Get-Date).Ticks - %start_ticks%); Write-Host ($ts.Minutes.ToString('00') + ' 分 ' + $ts.Seconds.ToString('00') + ' 秒')"`) do set "duration=%%a"
)
set "tm=时间未知"
for /f "usebackq tokens=*" %%t in (`powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "tm=%%t"

echo.
call :Print " ----------------------- 打包已结束 -----------------------"
echo.

if "%PACK_OK%"=="1" call :Success
if "%PACK_OK%"=="0" call :Failed

echo.
call :Print " 下一步操作？"
choice /c 12 /n /m "[1] 重新打包    [2] 退出 —— 按 1 或 2："

if !errorlevel! == 1 (
    echo.
    call :Print " 正在重启流程..."
    timeout /t 2 /nobreak >nul
    goto :MainExecution
)

echo.
echo =====================================================
call :Print "     程序已结束，请手动关闭窗口"
echo =====================================================
echo.
pause >nul
exit /b

:Print
echo %~1
exit /b

:Success
echo ██████████████████  打包成功！ ██████████████████
echo.
call :Print "     输出目录：%~dp0release"
call :Print "     开始时间：%start_tm%"
call :Print "     结束时间：%tm%"
call :Print "     本次耗时：%duration%"
echo.
exit /b

:Failed
echo ██████████████████  打包失败！ ██████████████████
echo.
call :Print "     请查看上方错误信息"
echo.
exit /b
