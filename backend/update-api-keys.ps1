# 更新 API Keys 的 PowerShell 脚本

Write-Host "=== API Keys 更新脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 现有的 API Keys（从 .env 文件中读取）
$envPath = Join-Path $PSScriptRoot ".env"

if (-not (Test-Path $envPath)) {
    Write-Host "❌ .env 文件不存在！" -ForegroundColor Red
    Write-Host "请先创建 .env 文件或运行 create-env.ps1 脚本" -ForegroundColor Yellow
    exit 1
}

# 读取现有的 API Keys
$envContent = Get-Content $envPath -Raw
$currentKeysLine = $envContent | Select-String "GOOGLE_API_KEYS"

if (-not $currentKeysLine) {
    Write-Host "❌ 未找到 GOOGLE_API_KEYS 配置！" -ForegroundColor Red
    exit 1
}

# 提取现有的 Keys
$currentKeys = ($currentKeysLine.ToString() -split '=')[1].Trim()

# 新的 API Keys
$newKeys = @(
    "AIzaSyAuszJoHwclX19YT-iLMEKfyS5oRrjfqVA",
    "AIzaSyBG6O23BRRb_Elq7B4OZ58xNulDFxkgbz0",
    "AIzaSyDvXCu6alMp6cVNjI_kWMWJUK61hnhayQA"
)

Write-Host "📋 当前 API Keys 数量: $($currentKeys.Split(',').Count)" -ForegroundColor Yellow
Write-Host "📋 新增 API Keys 数量: $($newKeys.Count)" -ForegroundColor Yellow
Write-Host ""

# 检查新 Keys 是否已存在
$existingKeys = $currentKeys.Split(',').ForEach({ $_.Trim() })
$keysToAdd = @()

foreach ($newKey in $newKeys) {
    if ($existingKeys -contains $newKey) {
        Write-Host "⚠️  Key 已存在，跳过: $($newKey.Substring(0, 20))..." -ForegroundColor Yellow
    } else {
        $keysToAdd += $newKey
        Write-Host "✅ 新 Key 将添加: $($newKey.Substring(0, 20))..." -ForegroundColor Green
    }
}

if ($keysToAdd.Count -eq 0) {
    Write-Host ""
    Write-Host "ℹ️  所有新 Keys 都已存在，无需更新" -ForegroundColor Cyan
    exit 0
}

# 合并所有 Keys
$allKeys = if ($keysToAdd.Count -gt 0) {
    "$currentKeys," + ($keysToAdd -join ',')
} else {
    $currentKeys
}

# 更新 .env 文件
$newEnvContent = $envContent -replace "GOOGLE_API_KEYS=.*", "GOOGLE_API_KEYS=$allKeys"

Set-Content -Path $envPath -Value $newEnvContent -Encoding UTF8

Write-Host ""
Write-Host "✅ API Keys 更新成功！" -ForegroundColor Green
Write-Host "📊 总 API Keys 数量: $($allKeys.Split(',').Count)" -ForegroundColor Cyan
Write-Host ""
Write-Host "⚠️  重要：请重启服务器以使新的 API Keys 生效！" -ForegroundColor Yellow
Write-Host "   运行命令: npm run dev" -ForegroundColor White

