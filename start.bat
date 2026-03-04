@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo 🚀 启动 云图 应用...
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js 未安装，请先安装 Node.js
    pause
    exit /b 1
)

REM 检查 npm 是否安装
where npm >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ npm 未安装，请先安装 npm
    pause
    exit /b 1
)

echo 📦 安装后端依赖...
call npm install
if %errorlevel% neq 0 (
    echo ❌ 后端依赖安装失败
    pause
    exit /b 1
)

echo.
echo 📦 安装前端依赖...
cd client
call npm install
if %errorlevel% neq 0 (
    echo ❌ 前端依赖安装失败
    cd ..
    pause
    exit /b 1
)

echo.
echo 🔨 构建前端...
call npm run build
if %errorlevel% neq 0 (
    echo ❌ 前端构建失败
    cd ..
    pause
    exit /b 1
)
cd ..

echo.
echo 🌐 启动服务器...
echo ✅ 应用已启动！
echo 📍 访问地址: http://localhost:3001
echo 🛑 按 Ctrl+C 停止服务
echo.

call npm start
