# 创建 .env 文件的 PowerShell 脚本

$envContent = @"
PORT=4000

# Google AI Studio API Keys（8个 Key，逗号分隔）
GOOGLE_API_KEYS=AIzaSyC3KPWZOzIqBaPtKt4oH3S-yGAaEjHP5EA,AIzaSyB6dj7Pya87G-D0WmPsrP1TXfDaPeNzhXU,AIzaSyD9p81FF2b7_pRi7hJEttU_HY6eCppCPds,AIzaSyBQsUxaAm2wLyZfQnoqYhytSxI89XYSjq0,AIzaSyBQMK0Cm_hkoJJFLqsu_oI8tnAuweRDAJs,AIzaSyBFj3yWwIrcJKu3wRjGd78Sz9vS_ypTd10,AIzaSyC2nKFWo5xY1qxiAULtIP5y-LTyWpdkJVQ,AIzaSyDMidZCtfEtlocrgwem5C_xAKxV01YXowE

# WordPress 配置（可选）
WORDPRESS_URL=https://vertu.com/
WORDPRESS_USERNAME=Long tail keywords
WORDPRESS_APP_PASSWORD=y4uh p63B lY26 yIJe uL2v oJSB

# WooCommerce 配置（可选，如果使用 Consumer Key/Secret 认证）
# WOOCOMMERCE_CONSUMER_KEY=ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# WOOCOMMERCE_CONSUMER_SECRET=cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
"@

$envPath = Join-Path $PSScriptRoot ".env"

if (Test-Path $envPath) {
    Write-Host "⚠️  .env 文件已存在，将被覆盖" -ForegroundColor Yellow
    $confirm = Read-Host "是否继续？(Y/N)"
    if ($confirm -ne "Y" -and $confirm -ne "y") {
        Write-Host "已取消" -ForegroundColor Red
        exit
    }
}

Set-Content -Path $envPath -Value $envContent -Encoding UTF8
Write-Host "✅ .env 文件已创建/更新成功！" -ForegroundColor Green
Write-Host "📍 文件位置: $envPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "请重启服务器以使配置生效：" -ForegroundColor Yellow
Write-Host "  npm run dev" -ForegroundColor White

