@echo off
setlocal

echo === Daily Laffs deploy fara Git (Cloud Run din folder local) ===
echo.

set "GCLOUD_BIN=C:\Users\ok\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if not exist "%GCLOUD_BIN%" (
  echo [ERROR] gcloud nu a fost gasit la:
  echo %GCLOUD_BIN%
  exit /b 1
)

set /p PROJECT_ID=GCP Project ID: 
set /p REGION=Region [europe-west1]: 
if "%REGION%"=="" set "REGION=europe-west1"
set /p SERVICE=Cloud Run service name [daily-laffs]: 
if "%SERVICE%"=="" set "SERVICE=daily-laffs"
set /p BUCKET=GCS bucket name (global unique): 
set /p SITE_URL=Public site URL temporar (ex: https://daily-laffs-xxx.run.app): 
set /p OPENAI_KEY=OpenAI API key: 

if "%PROJECT_ID%"=="" (
  echo [ERROR] PROJECT_ID lipseste.
  exit /b 1
)
if "%BUCKET%"=="" (
  echo [ERROR] BUCKET lipseste.
  exit /b 1
)
if "%OPENAI_KEY%"=="" (
  echo [ERROR] OPENAI_KEY lipseste.
  exit /b 1
)

echo.
echo [1/7] gcloud version
"%GCLOUD_BIN%" --version || exit /b 1

echo.
echo [2/7] auth login
"%GCLOUD_BIN%" auth login || exit /b 1

echo.
echo [3/7] set project
"%GCLOUD_BIN%" config set project %PROJECT_ID% || exit /b 1

echo.
echo [4/7] enable APIs
"%GCLOUD_BIN%" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com || exit /b 1

echo.
echo [5/7] ensure bucket exists
"%GCLOUD_BIN%" storage ls gs://%BUCKET% >nul 2>nul
if errorlevel 1 (
  "%GCLOUD_BIN%" storage buckets create gs://%BUCKET% --location=%REGION% --uniform-bucket-level-access || exit /b 1
) else (
  echo [INFO] Bucket exista deja: gs://%BUCKET%
)
"%GCLOUD_BIN%" storage buckets add-iam-policy-binding gs://%BUCKET% --member=allUsers --role=roles/storage.objectViewer || exit /b 1

echo.
echo [6/7] deploy din folderul local
"%GCLOUD_BIN%" run deploy %SERVICE% --source . --region %REGION% --allow-unauthenticated --set-env-vars "USE_GCS_STORAGE=true,GCS_BUCKET_NAME=%BUCKET%,GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/%BUCKET%,SITE_URL=%SITE_URL%,OPENAI_API_KEY=%OPENAI_KEY%" || exit /b 1

echo.
echo [7/7] service URL
"%GCLOUD_BIN%" run services describe %SERVICE% --region %REGION% --format="value(status.url)" || exit /b 1

echo.
echo Deploy fara Git finalizat.
endlocal
