$ErrorActionPreference = "Stop"

# ========== 配置 ==========
$sdkVer = "10.0.22621.0"
$kit = "C:\Program Files (x86)\Windows Kits\10"
$vs = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
$msvcVer = (Get-ChildItem "$vs\VC\Tools\MSVC" -Directory | Select-Object -Last 1).Name
$msvcRedistVer = (Get-ChildItem "$vs\VC\Redist\MSVC" -Directory | Select-Object -Last 1).Name

# ========== 设置环境变量 ==========
$env:Path = "$vs\VC\Tools\MSVC\$msvcVer\bin\Hostx64\x64;$kit\bin\$sdkVer\x64;$env:Path"
$env:INCLUDE = "$vs\VC\Tools\MSVC\$msvcVer\include;$kit\Include\$sdkVer\um;$kit\Include\$sdkVer\shared;$kit\Include\$sdkVer\ucrt"
$env:LIB = "$vs\VC\Tools\MSVC\$msvcVer\lib\x64;$kit\Lib\$sdkVer\um\x64;$kit\Lib\$sdkVer\ucrt\x64"

Write-Output "=== 1. 构建 Tauri 应用 ==="
npm run tauri:build 2>&1
if ($LASTEXITCODE -ne 0) { throw "构建失败" }

# ========== 嵌入 Windows 清单 ==========
Write-Output "`n=== 2. 嵌入 Windows 清单 ==="
$mt = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\mt.exe"
$exe = "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\target\release\ds-code.exe"
$manifest = "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\app.manifest"

& $mt -manifest $manifest "-outputresource:$exe;#1" 2>&1
if ($LASTEXITCODE -eq 0) { Write-Output "清单嵌入成功" } else { throw "清单嵌入失败" }

# ========== 读取当前版本号 ==========
$configPath = "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\tauri.conf.json"
$config = Get-Content $configPath | ConvertFrom-Json
$baseVersion = $config.version

# 查找最新的版本号
$exeDir = "E:\MySoftware\DSCode\Deepseek-tui-desktop\EXE"
$existingVersions = Get-ChildItem $exeDir -Directory | Where-Object { $_.Name -match "DSCode-v\d+\.\d+\.\d+-\d+" } | ForEach-Object { [int]($_.Name -replace '.*-(\d+)$', '$1') }
$nextBuildNum = 1
if ($existingVersions) { $nextBuildNum = ($existingVersions | Measure-Object -Maximum).Maximum + 1 }

$versionTag = "DSCode-v${baseVersion}-${nextBuildNum}"
Write-Output "`n=== 3. 创建便携版: $versionTag ==="

$outDir = "$exeDir\$versionTag"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Copy-Item $exe "$outDir\$versionTag.exe" -Force
Copy-Item "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\bin\deepseek.exe" "$outDir\deepseek.exe" -Force
Copy-Item "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\icons\icon.ico" "$outDir\icon.ico" -Force -ErrorAction SilentlyContinue
# Copy frontend dist (required for embedded HTTP server via tiny_http)
if (Test-Path "E:\MySoftware\DSCode\Deepseek-tui-desktop\dist\index.html") {
    if (Test-Path "$outDir\dist") { Remove-Item "$outDir\dist" -Recurse -Force }
    Copy-Item "E:\MySoftware\DSCode\Deepseek-tui-desktop\dist" "$outDir\" -Recurse -Force
    Write-Output "Frontend dist copied"
}

# Copy deepseek runtime binaries (deepseek-tui.exe is required by deepseek.exe dispatcher)
$npmDownloadDir = "E:\MySoftware\DSCode\Deepseek-tui-desktop\node_modules\deepseek-tui\bin\downloads"
if (Test-Path "$npmDownloadDir\deepseek-tui.exe") {
    Copy-Item "$npmDownloadDir\deepseek-tui.exe" "$outDir\deepseek-tui.exe" -Force
    Write-Output "deepseek-tui.exe copied"
}
if (Test-Path "$npmDownloadDir\deepseek.exe") {
    Copy-Item "$npmDownloadDir\deepseek.exe" "$outDir\deepseek.exe" -Force
    Write-Output "deepseek.exe copied (from npm downloads)"
}

# Copy VC++ redistributable DLLs required by deepseek.exe and deepseek-tui.exe
$redistDir = "$vs\VC\Redist\MSVC\$msvcRedistVer\x64\Microsoft.VC143.CRT"
$vcDlls = @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll", "concrt140.dll")
foreach ($dll in $vcDlls) {
    $dllPath = "$redistDir\$dll"
    if (Test-Path $dllPath) {
        Copy-Item $dllPath "$outDir\" -Force
        Write-Output "VC++ DLL copied: $dll"
    }
}

Copy-Item "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\target\release\bundle\msi\DSCode_${baseVersion}_x64_en-US.msi" "$exeDir\${versionTag}_installer.msi" -Force
Copy-Item "E:\MySoftware\DSCode\Deepseek-tui-desktop\src-tauri\target\release\bundle\nsis\DSCode_${baseVersion}_x64-setup.exe" "$exeDir\${versionTag}_setup.exe" -Force

# 验证清单
& $mt -inputresource:"$outDir\$versionTag.exe" -out:"$outDir\manifest_verify.xml" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) { Write-Output "清单验证通过" } else { Write-Output "警告: 清单验证失败" }

Write-Output "`n========== 构建完成 =========="
Write-Output "版本: $versionTag"
Write-Output "便携版: $outDir\$versionTag.exe"
Write-Output "安装包: $exeDir\${versionTag}_installer.msi"
Write-Output "安装包: $exeDir\${versionTag}_setup.exe"
Get-ChildItem $exeDir -Recurse | Select-Object Name, Length | Format-Table -AutoSize
