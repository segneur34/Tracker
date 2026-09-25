@echo off
rem Lance Tracker dans le navigateur : le serveur de developpement s'il ne
rem tourne pas deja (fenetre reduite, a fermer pour l'arreter), puis la page.
rem Cible du raccourci "Tracker" du bureau (outils\LISEZMOI.md).
cd /d "%~dp0.."
netstat -ano | findstr /R /C:":5173 .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://localhost:5173
) else (
  start "Tracker - serveur" /min cmd /c "npm run dev -- --open --strictPort"
)
