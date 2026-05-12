$ErrorActionPreference = "Stop"
$projectDir = "E:\MySoftware\DSCode\Deepseek-tui-desktop"

# Set VS Build Tools environment
$sdkVer = "10.0.22621.0"
$kit = "C:\Program Files (x86)\Windows Kits\10"
$vs = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
$msvcVer = (Get-ChildItem "$vs\VC\Tools\MSVC" -Directory | Select-Object -Last 1).Name

$env:Path = "$vs\VC\Tools\MSVC\$msvcVer\bin\Hostx64\x64;$kit\bin\$sdkVer\x64;$env:Path"
$env:INCLUDE = "$vs\VC\Tools\MSVC\$msvcVer\include;$kit\Include\$sdkVer\um;$kit\Include\$sdkVer\shared;$kit\Include\$sdkVer\ucrt"
$env:LIB = "$vs\VC\Tools\MSVC\$msvcVer\lib\x64;$kit\Lib\$sdkVer\um\x64;$kit\Lib\$sdkVer\ucrt\x64"

# Step 1: Build frontend
Write-Output "=== Step 1: Building frontend ==="
Set-Location $projectDir
npm run build 2>&1
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

# Step 2: Pre-compile .RC file (before cargo build, to avoid the Rust wait() bug)
Write-Output "`n=== Step 2: Compiling resource file ==="
$outDir = "src-tauri\target\release"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$rcExe = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\rc.exe"
& $rcExe /fo "src-tauri\target\release\app.res" /nologo "src-tauri\app.rc" 2>&1
if ($LASTEXITCODE -eq 0) { Write-Output "Resource compiled: app.res" } else { Write-Output "Warning: rc.exe failed, continuing..." }

# Step 3: Build Rust backend
Write-Output "`n=== Step 3: Building Rust backend ==="
cargo build --release 2>&1
if ($LASTEXITCODE -ne 0) { throw "Rust build failed" }

# Step 4: Embed Windows manifest
Write-Output "`n=== Step 4: Embedding Windows manifest ==="
$mt = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\mt.exe"
$exe = "src-tauri\target\release\ds-code.exe"
& $mt -manifest "src-tauri\app.manifest" "-outputresource:$exe;#1" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Output "Manifest embedded" } else { Write-Output "Warning: manifest embedding failed" }

# Step 5: Build installers with tauri
Write-Output "`n=== Step 5: Building installers ==="
npx tauri build 2>&1
if ($LASTEXITCODE -ne 0) { Write-Output "Warning: tauri build failed, portable version still available" }

# Step 6: Package portable version
Write-Output "`n=== Step 6: Packaging portable version ==="
$config = Get-Content "src-tauri\tauri.conf.json" | ConvertFrom-Json
$baseVersion = $config.version
$exeDir = "EXE"
$existingVersions = Get-ChildItem $exeDir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "DSCode-v\d+\.\d+\.\d+-\d+" } | ForEach-Object { [int]($_.Name -replace '.*-(\d+)$', '$1') }
$nextBuildNum = 1
if ($existingVersions) { $nextBuildNum = ($existingVersions | Measure-Object -Maximum).Maximum + 1 }
$versionTag = "DSCode-v${baseVersion}-${nextBuildNum}"

$outDir = "$exeDir\$versionTag"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
Copy-Item "src-tauri\target\release\ds-code.exe" "$outDir\$versionTag.exe" -Force
Copy-Item "src-tauri\bin\deepseek.exe" "$outDir\deepseek.exe" -Force
Copy-Item "src-tauri\icons\icon.ico" "$outDir\icon.ico" -Force -ErrorAction SilentlyContinue

Copy-Item "src-tauri\target\release\bundle\msi\DSCode_${baseVersion}_x64_en-US.msi" "${exeDir}\${versionTag}_installer.msi" -Force -ErrorAction SilentlyContinue
Copy-Item "src-tauri\target\release\bundle\nsis\DSCode_${baseVersion}_x64-setup.exe" "${exeDir}\${versionTag}_setup.exe" -Force -ErrorAction SilentlyContinue

Write-Output "`n========== BUILD COMPLETE =========="
Write-Output "Portable: $exeDir\$versionTag\$versionTag.exe"
Write-Output "Installer MSI: $exeDir\${versionTag}_installer.msi"
Write-Output "Installer NSIS: $exeDir\${versionTag}_setup.exe"
Get-ChildItem $exeDir -Recurse | Select-Object Name, Length | Format-Table -AutoSize

# Cleanup
Set-Location $projectDir
