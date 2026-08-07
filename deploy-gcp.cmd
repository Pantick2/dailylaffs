@echo off
setlocal

rem Always run from this script's directory so --source . points to project root
cd /d "%~dp0"

if not exist "Dockerfile" (
  echo [ERROR] Dockerfile not found in:
  echo %CD%
  echo Run this script from the project root repository.
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json not found in:
  echo %CD%
  exit /b 1
)

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
set /p MAKE_WEBHOOK_URL=Make webhook URL (optional, ex: https://hook.eu1.make.com/...): 
set "OPENAI_SECRET=OPENAI_API_KEY"

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
echo [4/10] enable APIs
"%GCLOUD_BIN%" services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com secretmanager.googleapis.com || exit /b 1

echo.
echo [5/10] ensure bucket exists
"%GCLOUD_BIN%" storage ls gs://%BUCKET% >nul 2>nul
if errorlevel 1 (
  "%GCLOUD_BIN%" storage buckets create gs://%BUCKET% --location=%REGION% --uniform-bucket-level-access || exit /b 1
) else (
  echo [INFO] Bucket already exists: gs://%BUCKET%
)

echo.
echo [6/10] make bucket objects public
"%GCLOUD_BIN%" storage buckets add-iam-policy-binding gs://%BUCKET% --member=allUsers --role=roles/storage.objectViewer || exit /b 1

echo.
echo [7/10] verify OpenAI secret and grant runtime access
"%GCLOUD_BIN%" secrets describe %OPENAI_SECRET% >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Secret %OPENAI_SECRET% not found in project %PROJECT_ID%.
  echo Create it first:
  echo   gcloud secrets create %OPENAI_SECRET% --replication-policy=automatic --data-file=-
  echo Then add the key as a version:
  echo   echo YOUR_KEY ^| gcloud secrets versions add %OPENAI_SECRET% --data-file=-
  exit /b 1
)

for /f %%i in ('"%GCLOUD_BIN%" projects describe %PROJECT_ID% --format^="value(projectNumber)"') do set "PROJECT_NUMBER=%%i"
if "%PROJECT_NUMBER%"=="" (
  echo [ERROR] Could not read project number.
  exit /b 1
)
set "RUNTIME_SA=%PROJECT_NUMBER%-compute@developer.gserviceaccount.com"
"%GCLOUD_BIN%" secrets add-iam-policy-binding %OPENAI_SECRET% --member=serviceAccount:%RUNTIME_SA% --role=roles/secretmanager.secretAccessor >nul || exit /b 1

echo.
echo [8/10] deploy Cloud Run service
set "ENV_VARS=USE_GCS_STORAGE=true,GCS_BUCKET_NAME=%BUCKET%,GCS_PUBLIC_BASE_URL=https://storage.googleapis.com/%BUCKET%,SITE_URL=%SITE_URL%,ENABLE_INTERNAL_SOCIAL_POSTS=false"
if not "%MAKE_WEBHOOK_URL%"=="" set "ENV_VARS=%ENV_VARS%,MAKE_WEBHOOK_URL=%MAKE_WEBHOOK_URL%"
"%GCLOUD_BIN%" run deploy %SERVICE% --source . --region %REGION% --allow-unauthenticated --set-env-vars "%ENV_VARS%" --set-secrets "OPENAI_API_KEY=%OPENAI_SECRET%:latest" || exit /b 1

echo.
echo [9/10] map root domain
"%GCLOUD_BIN%" beta run domain-mappings create --service %SERVICE% --domain %DOMAIN_ROOT% --region %REGION% || echo [WARN] root domain mapping failed (check domain ownership/DNS).

echo.
echo [10/10] map www domain
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
