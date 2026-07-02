# デプロイスクリプト（Cloud Run）
# 使い方: powershell -File scripts\deploy.ps1 [-AnonKey <anon key>] [-SkipChecks]
#   1. typecheck / lint / test をローカルで実行（落ちたらデプロイ中止）
#   2. gcloud builds submit（cloudbuild.yaml: build → push → deploy）
#   3. トラフィックが最新リビジョンに向いているか確認（固定の罠対策）
#   4. /api/health でスモークテスト
#   5. git tag deploy-YYYYMMDD-HHmmss を打つ（ロールバック先の記録）
# 失敗時は scripts\rollback.ps1 で直前リビジョンへ戻す。
param(
  [string]$AnonKey = $env:KOJIMA_SUPABASE_ANON_KEY,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
$REGION = 'asia-northeast1'
$SERVICE = 'kojima-farm-order-app'
$SUPABASE_URL = 'https://ggenmkcdwzpydbkpxpms.supabase.co'

Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not $AnonKey) {
  # 過去ビルドの substitution から自動取得
  Write-Host 'anon key を過去ビルドから取得中...'
  $lastBuild = gcloud builds list --limit=20 --format='value(id)' |
    ForEach-Object { $_ } | Select-Object -First 20
  foreach ($id in $lastBuild) {
    $k = gcloud builds describe $id --format='value(substitutions._NEXT_PUBLIC_SUPABASE_ANON_KEY)' 2>$null
    if ($k) { $AnonKey = $k; break }
  }
  if (-not $AnonKey) { throw 'anon key が見つかりません。-AnonKey か $env:KOJIMA_SUPABASE_ANON_KEY で指定してください。' }
}

if (-not $SkipChecks) {
  Write-Host '=== 事前チェック（typecheck / lint / test） ===' -ForegroundColor Cyan
  npm run typecheck; if ($LASTEXITCODE -ne 0) { throw 'typecheck 失敗。デプロイ中止。' }
  npm run lint;      if ($LASTEXITCODE -ne 0) { throw 'lint 失敗。デプロイ中止。' }
  npm run test;      if ($LASTEXITCODE -ne 0) { throw 'test 失敗。デプロイ中止。' }
}

Write-Host '=== Cloud Build 実行 ===' -ForegroundColor Cyan
gcloud builds submit --config cloudbuild.yaml `
  --substitutions="_NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL,_NEXT_PUBLIC_SUPABASE_ANON_KEY=$AnonKey" .
if ($LASTEXITCODE -ne 0) { throw 'Cloud Build 失敗。本番は変更されていません。' }

Write-Host '=== トラフィック確認 ===' -ForegroundColor Cyan
$latest  = gcloud run services describe $SERVICE --region=$REGION --format='value(status.latestReadyRevisionName)'
$serving = gcloud run services describe $SERVICE --region=$REGION --format='value(status.traffic[0].revisionName)'
$latestFlag = gcloud run services describe $SERVICE --region=$REGION --format='value(status.traffic[0].latestRevision)'
if ($latestFlag -ne 'True' -and $serving -ne $latest) {
  Write-Warning "トラフィックが最新 ($latest) に向いていません（現在: $serving）。--to-latest に切替えます。"
  gcloud run services update-traffic $SERVICE --region=$REGION --to-latest
  if ($LASTEXITCODE -ne 0) { throw 'トラフィック切替失敗。手動で確認してください。' }
}

Write-Host '=== スモークテスト (/api/health) ===' -ForegroundColor Cyan
$url = gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)'
$ok = $false
for ($i = 1; $i -le 6; $i++) {
  try {
    $res = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 20
    if ($res.status -eq 'ok') { $ok = $true; break }
    Write-Warning "health: $($res | ConvertTo-Json -Compress)"
  } catch { Write-Warning "health 接続失敗 ($i/6): $($_.Exception.Message)" }
  Start-Sleep -Seconds 10
}
if (-not $ok) {
  Write-Error "スモークテスト失敗。scripts\rollback.ps1 で直前リビジョンに戻してください。"
  exit 1
}

$tag = 'deploy-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
git tag $tag
Write-Host "✓ デプロイ成功: $url （git tag: $tag、リビジョン: $latest）" -ForegroundColor Green
Write-Host "  戻す場合: powershell -File scripts\rollback.ps1"
