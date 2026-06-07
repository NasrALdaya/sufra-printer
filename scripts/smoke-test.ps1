#!/usr/bin/env pwsh
# Smoke test for the Sufra Printer bridge.
# Assumes `pnpm tauri dev` (or a built binary) is running locally.

$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:9177'

Write-Host '=== /health ===' -ForegroundColor Cyan
$health = Invoke-RestMethod -Uri "$base/health" -Method GET
$health | ConvertTo-Json -Depth 5 | Write-Host

if (-not $health.ok) { Write-Error 'health returned ok=false'; exit 1 }
if ($health.version -isnot [string]) { Write-Error 'health missing version'; exit 1 }
Write-Host "OK — bridge v$($health.version), $($health.printers.Count) printer(s)" -ForegroundColor Green
Write-Host ''

# Minimal ESC/POS payload: init + 'Hello from smoke test' + LF + cut
$escposBytes = @(
    0x1B, 0x40,                                                      # ESC @  (initialize)
    0x48, 0x65, 0x6C, 0x6C, 0x6F, 0x20, 0x66, 0x72, 0x6F, 0x6D,      # "Hello from"
    0x20, 0x73, 0x6D, 0x6F, 0x6B, 0x65, 0x20, 0x74, 0x65, 0x73, 0x74, # " smoke test"
    0x0A, 0x0A, 0x0A,                                                # 3x LF
    0x1D, 0x56, 0x41, 0x10                                           # GS V A 16  (full cut, feed 16)
)
$b64 = [Convert]::ToBase64String([byte[]]$escposBytes)
$jobId = "smoke-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$body = @{
    role   = 'pos'
    format = 'escpos'
    data   = $b64
    jobId  = $jobId
} | ConvertTo-Json

Write-Host '=== POST /print (pos) ===' -ForegroundColor Cyan
Write-Host "  jobId: $jobId"
Write-Host "  payload: $($escposBytes.Length) bytes ESC/POS"
try {
    $resp = Invoke-RestMethod -Uri "$base/print" -Method POST -ContentType 'application/json' -Body $body
    $resp | ConvertTo-Json -Depth 5 | Write-Host
    if ($resp.ok) {
        Write-Host "OK — print accepted (jobId=$($resp.jobId))" -ForegroundColor Green
    } else {
        Write-Host "BRIDGE REJECTED: code=$($resp.code) message=$($resp.message)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ErrorDetails.Message) { Write-Host $_.ErrorDetails.Message -ForegroundColor Red }
    exit 1
}

Write-Host ''
Write-Host '=== CORS preflight (simulate dashboard origin) ===' -ForegroundColor Cyan
try {
    $cors = Invoke-WebRequest -Uri "$base/print" -Method OPTIONS `
        -Headers @{
            'Origin'                         = 'https://dashboard.sufra.app'
            'Access-Control-Request-Method'  = 'POST'
            'Access-Control-Request-Headers' = 'content-type'
        } -UseBasicParsing
    Write-Host "Status: $($cors.StatusCode)"
    Write-Host "Allow-Origin:  $($cors.Headers['Access-Control-Allow-Origin'])"
    Write-Host "Allow-Methods: $($cors.Headers['Access-Control-Allow-Methods'])"
    Write-Host "Allow-Headers: $($cors.Headers['Access-Control-Allow-Headers'])"
    if ($cors.Headers['Access-Control-Allow-Origin'] -eq 'https://dashboard.sufra.app') {
        Write-Host 'OK — CORS allows dashboard origin' -ForegroundColor Green
    } else {
        Write-Host 'WARN — dashboard origin not in allowlist' -ForegroundColor Yellow
    }
} catch {
    Write-Host "CORS preflight failed: $($_.Exception.Message)" -ForegroundColor Yellow
}
