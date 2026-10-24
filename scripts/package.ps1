# Package the audited Git index; keep historical working-directory packagers private.
param([ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$')][string]$Name = 'rewards-stack-source')
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $packageRoot
try {
    & node (Join-Path $PSScriptRoot 'package-public.mjs') $Name
    if ($LASTEXITCODE -ne 0) { throw 'Public source packaging failed.' }
} finally { Pop-Location }
