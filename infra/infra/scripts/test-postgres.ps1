param(
  [string]$Database = "tk_mg_test_local",
  [int]$Port = 55432
)

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

if (-not $Database.StartsWith("tk_mg_test_")) {
  throw "Database must start with tk_mg_test_. Received: $Database"
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envFile = Join-Path ([System.IO.Path]::GetTempPath()) "tk-mg-postgres-test.env"
$composeArgs = @(
  "compose",
  "--env-file", $envFile,
  "-f", (Join-Path $repoRoot "infra\docker-compose.yml"),
  "-f", (Join-Path $repoRoot "infra\docker-compose.test.yml")
)

@"
POSTGRES_DB=tk_mg
POSTGRES_USER=tk_mg
POSTGRES_PASSWORD=tk_mg_test_password
POSTGRES_PASSWORD_URL_ENCODED=tk_mg_test_password
POSTGRES_TEST_PORT=$Port
REDIS_PASSWORD=tk_mg_test_redis_password
REDIS_PASSWORD_URL_ENCODED=tk_mg_test_redis_password
SECRET_ENCRYPTION_KEY=01234567890123456789012345678901
WEB_BIND_ADDRESS=127.0.0.1
WEB_PORT=18080
ADMIN_BOOTSTRAP_EMAIL=admin@example.internal
ADMIN_BOOTSTRAP_PASSWORD=tk_mg_test_admin_password
NAS_PROTOCOL=
NAS_HOST=
NAS_SHARE_OR_BUCKET=
NAS_USERNAME=
NAS_PASSWORD=
"@ | Set-Content -LiteralPath $envFile -NoNewline -Encoding utf8

try {
  $dockerInfoOutput = Join-Path ([System.IO.Path]::GetTempPath()) "tk-mg-docker-info.out"
  $dockerInfoError = Join-Path ([System.IO.Path]::GetTempPath()) "tk-mg-docker-info.err"
  $dockerInfo = Start-Process `
    -FilePath "docker" `
    -ArgumentList @("info") `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardError $dockerInfoError `
    -RedirectStandardOutput $dockerInfoOutput `
    -Wait
  Remove-Item -LiteralPath $dockerInfoOutput, $dockerInfoError -ErrorAction SilentlyContinue
  if ($dockerInfo.ExitCode -ne 0) {
    throw "Docker daemon is not running. Start Docker Desktop, then rerun pnpm test:postgres:local."
  }

  & docker @composeArgs up -d postgres
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose up failed with exit code $LASTEXITCODE"
  }

  $deadline = (Get-Date).AddSeconds(60)
  do {
    & docker @composeArgs exec -T postgres pg_isready -U tk_mg -d tk_mg | Out-Null
    if ($LASTEXITCODE -eq 0) {
      break
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)

  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL test container did not become ready"
  }

  & docker @composeArgs exec -T postgres createdb -U tk_mg $Database 2>$null
  if ($LASTEXITCODE -ne 0) {
    & docker @composeArgs exec -T postgres psql -U tk_mg -d postgres -tAc "select 1 from pg_database where datname = '$Database'" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Could not create or verify database $Database"
    }
  }

  $env:TEST_DATABASE_URL = "postgres://tk_mg:tk_mg_test_password@127.0.0.1:$Port/$Database"
  pnpm --filter @tk-mg/api test:postgres
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL integration tests failed with exit code $LASTEXITCODE"
  }
} finally {
  Remove-Item -LiteralPath $envFile -ErrorAction SilentlyContinue
}
