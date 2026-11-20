@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ================================
echo   نشر التصميم الجديد لمركز القيادة
echo ================================
echo انتظر عدة دقائق...
call railway up
if errorlevel 1 (
  echo.
  echo لم ينجح النشر. إن ظهرت عبارة "No linked project" شغّل الأمر: railway link
  echo ثم اختر مشروع مركز القيادة وأعد تشغيل هذا الملف.
) else (
  echo.
  echo تم. افتح الموقع واضغط Ctrl+Shift+R
)
pause
