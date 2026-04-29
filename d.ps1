$projectRoot = "C:\Users\BHARAT S SHAH\Stampede-AI - DEPLOY"
$backendRoot = "$projectRoot\backend"

cd $projectRoot

Write-Host "Starting backend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$backendRoot'; python main.py"

Start-Sleep -Seconds 5

Write-Host "Starting Cloudflare tunnel..."
$logFile = "$projectRoot\cf.log"

if (Test-Path $logFile) {
    Remove-Item $logFile
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$projectRoot'; cloudflared tunnel --url http://localhost:8000 *> cf.log"

Write-Host "Waiting for Cloudflare URL..."

$url = $null

for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2

    if (Test-Path $logFile) {
        $log = Get-Content $logFile -Raw
        $match = [regex]::Match($log, "https://[a-zA-Z0-9-]+\.trycloudflare\.com")

        if ($match.Success) {
            $url = $match.Value
            break
        }
    }
}

if (-not $url) {
    Write-Host "Could not find Cloudflare URL. Check cf.log manually."
    exit
}

Write-Host "Cloudflare URL found: $url"

# Update only VITE_API_URL in .env file, preserving other variables
$envFile = "$projectRoot\.env"
$envContent = ""

if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
}

# Replace or add VITE_API_URL - use line-by-line approach
$lines = $envContent -split "`n"
$newLines = @()
$found = $false

foreach ($line in $lines) {
    if ($line -match "^VITE_API_URL=") {
        $newLines += "VITE_API_URL=$url"
        $found = $true
    } elseif ($line.Trim() -ne "") {
        $newLines += $line
    }
}

if (-not $found) {
    $newLines += "VITE_API_URL=$url"
}

$envContent = $newLines -join "`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($envFile, $envContent, $utf8NoBom)

Write-Host "Building frontend..."
npm.cmd run build

Write-Host "Deploying Firebase..."
firebase.cmd deploy
