$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptDir 'app'

if (-not (Test-Path -LiteralPath $appDir)) {
  Write-Host 'app folder not found.' -ForegroundColor Red
  Read-Host 'Press Enter to exit'
  exit 1
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = ($listener.LocalEndpoint).Port
  $listener.Stop()
  return $port
}

function Get-ContentType([string]$path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js' { 'application/javascript; charset=utf-8' }
    '.css' { 'text/css; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.svg' { 'image/svg+xml' }
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.gif' { 'image/gif' }
    '.webp' { 'image/webp' }
    '.ico' { 'image/x-icon' }
    '.txt' { 'text/plain; charset=utf-8' }
    default { 'application/octet-stream' }
  }
}

function Get-StatusText([int]$code) {
  switch ($code) {
    200 { 'OK' }
    404 { 'Not Found' }
    default { 'OK' }
  }
}

function Write-HttpResponse(
  [System.Net.Sockets.NetworkStream]$stream,
  [int]$statusCode,
  [byte[]]$body,
  [string]$contentType
) {
  $statusText = Get-StatusText $statusCode
  $header = @(
    "HTTP/1.1 $statusCode $statusText",
    "Content-Type: $contentType",
    "Content-Length: $($body.Length)",
    'Connection: close',
    ''
    ''
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
  $stream.Flush()
}

function Get-RequestedPath([string]$requestLine) {
  if ([string]::IsNullOrWhiteSpace($requestLine)) {
    return 'index.html'
  }

  $parts = $requestLine.Split(' ')
  if ($parts.Length -lt 2) {
    return 'index.html'
  }

  $rawPath = $parts[1]
  if ([string]::IsNullOrWhiteSpace($rawPath) -or $rawPath -eq '/') {
    return 'index.html'
  }

  $pathOnly = $rawPath.Split('?')[0].TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($pathOnly)) {
    return 'index.html'
  }

  return [Uri]::UnescapeDataString($pathOnly).Replace('/', '\')
}

function Resolve-SafeFilePath([string]$rootDir, [string]$relativePath) {
  $rootFull = [System.IO.Path]::GetFullPath($rootDir)
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relativePath))
  $rootWithSep = if ($rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $rootFull } else { "$rootFull\" }
  if (-not $candidate.StartsWith($rootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  return $candidate
}

$port = Get-FreePort
$prefix = "http://127.0.0.1:$port/"
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
$listener.Start()

Write-Host "Share package started at $prefix" -ForegroundColor Green
Write-Host 'Keep this window open. Close it to stop the server.' -ForegroundColor Yellow
try {
  Start-Process $prefix | Out-Null
} catch {
  Write-Host 'Browser did not open automatically. Please open the URL above manually.' -ForegroundColor Yellow
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()

    try {
      $stream = $client.GetStream()
      $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 4096, $true)

      $requestLine = $reader.ReadLine()
      while ($true) {
        $line = $reader.ReadLine()
        if ($null -eq $line -or $line -eq '') {
          break
        }
      }

      $relativePath = Get-RequestedPath $requestLine
      $candidatePath = Resolve-SafeFilePath -rootDir $appDir -relativePath $relativePath

      if (
        $candidatePath -and
        (Test-Path -LiteralPath $candidatePath) -and
        -not (Get-Item -LiteralPath $candidatePath).PSIsContainer
      ) {
        $filePath = $candidatePath
        $statusCode = 200
      } else {
        $filePath = Join-Path $appDir 'index.html'
        $statusCode = 200
      }

      $body = [System.IO.File]::ReadAllBytes($filePath)
      $contentType = Get-ContentType $filePath
      Write-HttpResponse -stream $stream -statusCode $statusCode -body $body -contentType $contentType
    }
    finally {
      if ($reader) {
        $reader.Dispose()
      }
      if ($stream) {
        $stream.Dispose()
      }
      $client.Close()
    }
  }
}
catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host 'Press Enter to exit'
}
finally {
  $listener.Stop()
}
