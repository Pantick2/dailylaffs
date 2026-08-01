@echo off
setlocal

echo === Daily Laffs GCP Deploy (CMD) ===
echo.

set "GCLOUD_BIN=C:\Users\ok\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"
if not exist "%GCLOUD_BIN%" (
  echo [ERROR] gcloud not found at:
  echo %GCLOUD_BIN%
  echo Install path was not found. Please install Google Cloud CLI first.
  exit /b 1
)

set /p PROJECT_ID=GCP Project ID: 
set /p REGION=Region [europe-west1]: 
if "%REGION%"=="" set "REGION=europe-west1"
set /p SERVICE=Cloud Run service name [daily-laffs]: 
if "%SERVICE%"=="" set "SERVICE=daily-laffs"
set /p BUCKET=GCS bucket name (must be globally unique): 
set /p DOMAIN_ROOT=Root domain (ex: domeniu.ro): 
set /p DOMAIN_WWW=WWW domain (ex: www.domeniu.ro): 
set /p SITE_URL=Public site URL (ex: https://domeniu.ro): 
set /p OPENAI_KEY=OpenAI API key: 

if "%PROJECT_ID%"=="" (
  echo [ERROR] PROJECT_ID is required.
  exit /b 1
)
if "%PROJECT_ID%"=="proiectul-tau-gcp" (
  echo [ERROR] Replace placeholder PROJECT_ID with your real GCP project ID.
  exit /b 1
)
if "%BUCKET%"=="" (
  echo [ERROR] BUCKET is required.
  exit /b 1
)
if "%SITE_URL%"=="" (
  echo [ERROR] SITE_URL is required.
  exit /b 1
)

echo.
echo [1/9] gcloud version
"%GCLOUD_BIN%" --version || exit /b 1

echo.
echo [2/9] gcloud auth login
"%GCLOUD_BIN%" auth login || exit /b 1

echo.
echo [3/9] set project
"%GCLOUD_BIN%" config set project %PROJECT_ID% || exit /b 1

echo.
echo [4/9] enable APIs
"%GCLOUD_BIN%" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com || exit /b 1

echo.
echo [5/9] ensure bucket exists
"%GCLOUD_BIN%" storage ls gs://%BUCKET% >nul 2>nul
if errorlevel 1 (
  "%GCLOUD_BIN%" storage buckets create gs://%BUCKET% --location=%REGION% --uniform-bucket-level-access || exit /b 1
) else (
  echo [INFO] Bucket already exists: gs://%BUCKET%
)

echo.
echo [6/9] make bucket objects public
"%GCLOUD_BIN%" storage buckets add-iam-policy-binding gs://%BUCKET% --member=allUsers --role=roles/storage.objectViewer || exit /b 1

echo.
echo [7/9] deploy Cloud Run service
"%GCLOUD_BIN%" run deploy %SERVICE% --source . --region %REGION% --allow-unauthenticated --set-env-vars "USE_GCS_STORAGE=true,GCS_BUCKET_NAME=%BUCKET%,GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/%BUCKET%,SITE_URL=%SITE_URL%,OPENAI_API_KEY=%OPENAI_KEY%" || exit /b 1

echo.
echo [8/9] map root domain
"%GCLOUD_BIN%" beta run domain-mappings create --service %SERVICE% --domain %DOMAIN_ROOT% --region %REGION% || echo [WARN] root domain mapping failed (check domain ownership/DNS).

echo.
echo [9/9] map www domain
"%GCLOUD_BIN%" beta run domain-mappings create --service %SERVICE% --domain %DOMAIN_WWW% --region %REGION% || echo [WARN] www mapping failed (check DNS).

echo.
echo === DNS instructions ===
"%GCLOUD_BIN%" beta run domain-mappings describe --domain %DOMAIN_ROOT% --region %REGION%
"%GCLOUD_BIN%" beta run domain-mappings describe --domain %DOMAIN_WWW% --region %REGION%

echo.
echo === Service URL ===
"%GCLOUD_BIN%" run services describe %SERVICE% --region %REGION% --format="value(status.url)"

echo.
echo Deploy flow finished.
endlocal
