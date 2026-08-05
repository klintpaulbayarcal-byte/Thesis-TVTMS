$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $ProjectRoot 'backend'
$EnvExample = Join-Path $Backend '.env.example'
$EnvFile = Join-Path $Backend '.env'
$DatabaseSql = Join-Path $Backend 'models\database.sql'
$ProjectParent = Split-Path -Parent $ProjectRoot
$InferredXamppRoot = Split-Path -Parent $ProjectParent
$XamppRoot = if (Test-Path (Join-Path $InferredXamppRoot 'mysql\bin\mysql.exe')) {
    $InferredXamppRoot
} else {
    'C:\xampp'
}
$MysqlExe = Join-Path $XamppRoot 'mysql\bin\mysql.exe'
$XamppStart = Join-Path $XamppRoot 'xampp_start.exe'
$XamppControl = Join-Path $XamppRoot 'xampp-control.exe'

function Write-Header {
    Clear-Host
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host ' Municipal Traffic Violation System - First-Time Setup' -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor DarkCyan
    Write-Host ''
}

function Write-Step([string]$Text) {
    Write-Host "`n[SETUP] $Text" -ForegroundColor Yellow
}

function Read-Default([string]$Prompt, [string]$Default) {
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim()
}

function Get-PlainText([Security.SecureString]$SecureValue) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-Port([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $result = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $result.AsyncWaitHandle.WaitOne(800)) { return $false }
        $client.EndConnect($result)
        return $true
    } catch { return $false }
    finally { $client.Close() }
}

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    try { $rng.GetBytes($bytes) }
    finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

function Invoke-MySqlFile(
    [string]$SqlPath,
    [string]$HostName,
    [string]$Port,
    [string]$UserName,
    [Security.SecureString]$Password
) {
    $mysqlArguments = @(
        '--protocol=tcp'
        "--host=$HostName"
        "--port=$Port"
        "--user=$UserName"
        '--default-character-set=utf8mb4'
    )

    # MYSQL_PWD keeps the password out of the process command line. Removing it
    # entirely supports the normal blank-password XAMPP root account.
    $previousMysqlPassword = [Environment]::GetEnvironmentVariable('MYSQL_PWD', 'Process')
    $plainPassword = $null
    try {
        $plainPassword = if ($null -eq $Password) { '' } else { Get-PlainText $Password }
        if ([string]::IsNullOrEmpty($plainPassword)) {
            [Environment]::SetEnvironmentVariable('MYSQL_PWD', $null, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable('MYSQL_PWD', $plainPassword, 'Process')
        }

        $output = Get-Content -LiteralPath $SqlPath -Raw -Encoding UTF8 | & $MysqlExe @mysqlArguments 2>&1
        $mysqlExitCode = $LASTEXITCODE
        if ($output) { $output | ForEach-Object { Write-Host $_ } }
        if ($mysqlExitCode -ne 0) {
            throw "Database import failed (mysql exit code $mysqlExitCode)."
        }
    } finally {
        [Environment]::SetEnvironmentVariable('MYSQL_PWD', $previousMysqlPassword, 'Process')
        $plainPassword = $null
        $previousMysqlPassword = $null
    }
}

function Save-EnvironmentFile([hashtable]$Values) {
    $lines = @(
        'NODE_ENV=development',
        'TZ=Asia/Manila',
        'PORT=5000',
        'TRUST_PROXY=0',
        '',
        "DB_HOST=$($Values.DB_HOST)",
        "DB_PORT=$($Values.DB_PORT)",
        "DB_USER=$($Values.DB_USER)",
        "DB_PASSWORD=$($Values.DB_PASSWORD)",
        "DB_NAME=$($Values.DB_NAME)",
        'DB_POOL_SIZE=10',
        'DB_TIMEZONE=+08:00',
        '',
        "JWT_SECRET=$($Values.JWT_SECRET)",
        'JWT_EXPIRES_IN=8h',
        '',
        'ALLOWED_ORIGINS=http://localhost,http://127.0.0.1',
        "APP_PUBLIC_URL=$($Values.APP_PUBLIC_URL)",
        '',
        'SMTP_HOST=smtp.gmail.com',
        'SMTP_PORT=587',
        'SMTP_USER=',
        'SMTP_PASS=',
        'SMTP_FROM="Calape Traffic Enforcement <no-reply@example.gov.ph>"',
        'CONTACT_TO_EMAIL=',
        '',
        "INITIAL_ADMIN_NAME=$($Values.ADMIN_NAME)",
        "INITIAL_ADMIN_EMAIL=$($Values.ADMIN_EMAIL)",
        "INITIAL_ADMIN_PASSWORD=$($Values.ADMIN_PASSWORD)"
    )
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($EnvFile, ($lines -join "`r`n") + "`r`n", $utf8NoBom)
}

function Clear-InitialAdminPassword([string]$Path = $EnvFile) {
    $content = [IO.File]::ReadAllText($Path)
    $content = [Text.RegularExpressions.Regex]::Replace($content, '(?m)^INITIAL_ADMIN_PASSWORD=.*$', 'INITIAL_ADMIN_PASSWORD=')
    $utf8NoBom = New-Object Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $content, $utf8NoBom)
}

try {
    Write-Header
    Write-Host 'This setup is for the FIRST RUN on a Windows laptop with XAMPP.' -ForegroundColor White
    Write-Host 'It will prepare .env, import the database, install packages, create the first Admin, and run the system.' -ForegroundColor Gray
    Write-Host ''
    Read-Host 'Press ENTER to continue'

    Write-Step 'Checking required files and programs...'
    foreach ($path in @($Backend, $EnvExample, $DatabaseSql, $MysqlExe)) {
        if (-not (Test-Path $path)) { throw "Required item not found: $path" }
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) { throw 'Node.js/npm was not found. Install Node.js 20 or newer first.' }
    $nodeVersion = (& node --version).Trim()
    $major = [int]($nodeVersion.TrimStart('v').Split('.')[0])
    if ($major -lt 20) { throw "Node.js 20 or newer is required. Installed: $nodeVersion" }
    Write-Host "[OK] Node.js $nodeVersion" -ForegroundColor Green
    Write-Host '[OK] XAMPP MySQL client found' -ForegroundColor Green

    Write-Step 'Starting Apache and MySQL...'
    if ((Test-Path $XamppStart) -and (-not (Test-Port 80) -or -not (Test-Port 3306))) {
        Start-Process -FilePath $XamppStart -WindowStyle Minimized
        Start-Sleep -Seconds 6
    }
    if (-not (Test-Port 80) -or -not (Test-Port 3306)) {
        if (Test-Path $XamppControl) { Start-Process -FilePath $XamppControl }
        Write-Host 'In XAMPP, click START for Apache and MySQL.' -ForegroundColor Cyan
        Read-Host 'After both are green/running, press ENTER here'
    }
    if (-not (Test-Port 80)) { throw 'Apache is not listening on port 80.' }
    if (-not (Test-Port 3306)) { throw 'MySQL is not listening on port 3306.' }
    Write-Host '[OK] Apache and MySQL are running' -ForegroundColor Green

    Write-Step 'Collecting local database settings...'
    $dbHost = Read-Default 'Database host' 'localhost'
    $dbPort = Read-Default 'Database port' '3306'
    $dbUser = Read-Default 'Database user' 'root'
    $dbSecure = Read-Host 'Database password (press ENTER if XAMPP root has no password)' -AsSecureString
    $dbPassword = Get-PlainText $dbSecure
    $dbName = Read-Default 'Database name' 'violation_system'

    Write-Step 'Creating the first Administrator account...'
    $adminName = Read-Default 'Administrator full name' 'System Administrator'
    do {
        $adminEmail = (Read-Host 'Administrator email').Trim().ToLower()
        if ($adminEmail -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { Write-Host 'Enter a valid email address.' -ForegroundColor Red }
    } until ($adminEmail -match '^[^\s@]+@[^\s@]+\.[^\s@]+$')

    do {
        $adminSecure = Read-Host 'Admin password (12+ chars, uppercase, lowercase, number, symbol)' -AsSecureString
        $adminPassword = Get-PlainText $adminSecure
        $validPassword = $adminPassword.Length -ge 12 -and $adminPassword -match '[a-z]' -and $adminPassword -match '[A-Z]' -and $adminPassword -match '\d' -and $adminPassword -match '[^A-Za-z0-9]'
        if (-not $validPassword) { Write-Host 'Password is not strong enough. Try again.' -ForegroundColor Red }
    } until ($validPassword)

    $projectFolder = Split-Path $ProjectRoot -Leaf
    $publicUrl = "http://localhost/$projectFolder/frontend"
    $envValues = @{
        DB_HOST = $dbHost
        DB_PORT = $dbPort
        DB_USER = $dbUser
        DB_PASSWORD = $dbPassword
        DB_NAME = $dbName
        JWT_SECRET = New-RandomSecret
        APP_PUBLIC_URL = $publicUrl
        ADMIN_NAME = $adminName
        ADMIN_EMAIL = $adminEmail
        ADMIN_PASSWORD = $adminPassword
    }

    if (Test-Path $EnvFile) {
        $backup = "$EnvFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        Copy-Item $EnvFile $backup
        Clear-InitialAdminPassword -Path $backup
        Write-Host "Existing .env backed up to: $backup" -ForegroundColor Gray
    }
    Save-EnvironmentFile $envValues
    $envValues.DB_PASSWORD = $null
    $dbPassword = $null
    Write-Host '[OK] backend/.env created' -ForegroundColor Green

    Write-Step 'Importing the database schema and starter violation records...'
    try {
        Invoke-MySqlFile -SqlPath $DatabaseSql -HostName $dbHost -Port $dbPort -UserName $dbUser -Password $dbSecure
    } finally {
        if ($null -ne $dbSecure) { $dbSecure.Dispose() }
        $dbSecure = $null
    }
    Write-Host '[OK] Database imported' -ForegroundColor Green

    Write-Step 'Installing backend packages...'
    Push-Location $Backend
    try {
        $dependenciesReady = $false
        if (Test-Path (Join-Path $Backend 'node_modules')) {
            Write-Host 'Existing node_modules found; validating installed dependencies...' -ForegroundColor Gray
            & npm.cmd ls --omit=dev --depth=0
            $dependenciesReady = ($LASTEXITCODE -eq 0)
        }

        if ($dependenciesReady) {
            Write-Host '[OK] Existing backend packages are complete and will be reused' -ForegroundColor Green
        } else {
            if (Test-Port 5000) {
                throw 'Backend packages need repair, but port 5000 is in use. Close the running backend, then rerun setup.'
            }
            & npm.cmd ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
            Write-Host '[OK] Backend packages installed from package-lock.json' -ForegroundColor Green
        }

        Write-Step 'Verifying the project...'
        & npm.cmd run verify
        if ($LASTEXITCODE -ne 0) { throw 'Project verification failed.' }

        Write-Step 'Creating the first Administrator...'
        $adminOutput = @(& npm.cmd run create-admin 2>&1)
        $adminExitCode = $LASTEXITCODE
        $adminOutput | ForEach-Object { Write-Host $_ }
        if ($adminExitCode -ne 0) {
            throw 'Administrator provisioning failed. Review the specific message above; no existing account was deleted or assigned a different role.'
        }
    } finally {
        Pop-Location
    }

    Clear-InitialAdminPassword
    $adminPassword = $null
    Write-Host '[OK] Administrator created or updated and temporary password removed from .env' -ForegroundColor Green

    Write-Step 'Starting the backend and opening the landing page...'
    if (-not (Test-Port 5000)) {
        Start-Process cmd.exe -ArgumentList '/k', "cd /d `"$Backend`" && npm start" -WindowStyle Minimized
        Start-Sleep -Seconds 5
    }
    if (-not (Test-Port 5000)) {
        throw 'Backend did not start on port 5000. Check the minimized backend Command Prompt window.'
    }

    $landingUrl = "$publicUrl/pages/landing.html"
    Start-Process $landingUrl

    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkGreen
    Write-Host ' SETUP COMPLETED SUCCESSFULLY' -ForegroundColor Green
    Write-Host '============================================================' -ForegroundColor DarkGreen
    Write-Host "Landing page: $landingUrl"
    Write-Host "Admin email:  $adminEmail"
    Write-Host 'Use OPEN_VVS.bat for the next runs.' -ForegroundColor Cyan
    Write-Host 'SMTP/email is still optional and can be configured later in backend/.env.' -ForegroundColor Yellow
    Write-Host ''
    Read-Host 'Press ENTER to close this setup window'
}
catch {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor DarkRed
    Write-Host ' SETUP STOPPED - NOTHING WAS HIDDEN' -ForegroundColor Red
    Write-Host '============================================================' -ForegroundColor DarkRed
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'Take a clear photo/screenshot of this error and send it in ChatGPT.' -ForegroundColor Yellow
    Read-Host 'Press ENTER to close'
    exit 1
}
