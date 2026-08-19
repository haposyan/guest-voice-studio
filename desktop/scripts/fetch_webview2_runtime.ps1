# Downloads and extracts the WebView2 "Fixed Version" runtime into
# desktop/webview2runtime/, so it can be bundled with the app and end users
# never need to install anything separately (see MainWindow.xaml.cs).
#
# The download link below was captured from
# https://developer.microsoft.com/microsoft-edge/webview2/#download (Fixed
# Version section, x64, EULA-accepted "Download" button) and is a signed,
# time-limited CDN URL — it WILL eventually expire. If this script fails,
# get a fresh link manually:
#   1. Open https://developer.microsoft.com/microsoft-edge/webview2/
#   2. Scroll to "Download the WebView2 Runtime" > "Fixed Version"
#   3. Pick the desired version (this project was built against 151.0.4129.93)
#      and Architecture = x64
#   4. Click Download, accept the EULA, copy the resulting download link
#      (it points at msedge.sf.dl.delivery.mp.microsoft.com) and pass it via -Url
param(
  [string]$Url = "https://msedge.sf.dl.delivery.mp.microsoft.com/filestreamingservice/files/1424552f-1033-46d3-a1ea-26c879f4262b/Microsoft.WebView2.FixedVersionRuntime.151.0.4129.93.x64.cab"
)
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$dest = Join-Path $root "webview2runtime"
$tmpCab = Join-Path $env:TEMP "webview2_fixed_runtime.cab"
$tmpExtract = Join-Path $env:TEMP "webview2_fixed_runtime_extract"

Write-Output "Downloading WebView2 Fixed Version runtime (~300MB)..."
$ProgressPreference = 'SilentlyContinue'
Invoke-WebRequest -Uri $Url -OutFile $tmpCab -UseBasicParsing

if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
New-Item -ItemType Directory -Force -Path $tmpExtract | Out-Null
Write-Output "Extracting..."
expand.exe $tmpCab -F:* $tmpExtract | Out-Null

$inner = Get-ChildItem $tmpExtract -Directory | Select-Object -First 1
if (-not $inner) { throw "Unexpected CAB layout — no runtime folder found after extraction." }

if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Move-Item $inner.FullName $dest
Remove-Item -Force $tmpCab
Remove-Item -Recurse -Force $tmpExtract

Write-Output "Done. Runtime is at $dest"
