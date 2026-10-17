# ロールバックスクリプト（Cloud Run）
# 使い方:
#   powershell -File scripts\rollback.ps1            → リビジョン一覧を表示して番号で選択
#   powershell -File scripts\rollback.ps1 -Revision <name>  → 指定リビジョンへ即切替
#   powershell -File scripts\rollback.ps1 -ToLatest  → 平常運用（最新追従）へ復帰
# 仕組み: Cloud Run の過去リビジョンへトラフィックを 100% 切替えるだけ（ビルド不要・数秒で完了）。
# 注意: ロールバック中は「特定リビジョン固定」状態。復旧後は必ず -ToLatest で戻すこと
#       （固定のまま次のデプロイをすると serving 0% で反映されない罠がある）。
param(
  [string]$Revision,
  [switch]$ToLatest
)

$ErrorActionPreference = 'Stop'
$REGION = 'asia-northeast1'
$SERVICE = 'kojima-farm-order-app'

if ($ToLatest) {
  gcloud run services update-traffic $SERVICE --region=$REGION --to-latest
  Write-Host '✓ 平常運用（最新リビジョン追従）に復帰しました。' -ForegroundColor Green
  exit 0
}

if (-not $Revision) {
  Write-Host '=== 現在のトラフィック ===' -ForegroundColor Cyan
  gcloud run services describe $SERVICE --region=$REGION --format='yaml(status.traffic)'
  Write-Host "`n=== リビジョン一覧（新しい順） ===" -ForegroundColor Cyan
  gcloud run revisions list --service=$SERVICE --region=$REGION `
    --format='table(metadata.name,metadata.creationTimestamp,status.conditions[0].status)' --limit=10
  $Revision = Read-Host "`n戻したいリビジョン名を入力（中止は空Enter）"
  if (-not $Revision) { Write-Host '中止しました。'; exit 0 }
}

Write-Host "=== $Revision へトラフィック切替 ===" -ForegroundColor Cyan
gcloud run services update-traffic $SERVICE --region=$REGION --to-revisions="$Revision=100"
if ($LASTEXITCODE -ne 0) { throw '切替失敗。リビジョン名を確認してください。' }

# スモークテスト
$url = gcloud run services describe $SERVICE --region=$REGION --format='value(status.url)'
try {
  $res = Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 20
  Write-Host "health: $($res | ConvertTo-Json -Compress)"
} catch {
  Write-Warning "health エンドポイント無し/失敗（古いリビジョンには /api/health が無い場合があります）。$url を目視確認してください。"
}

Write-Host "✓ ロールバック完了: $Revision" -ForegroundColor Green
Write-Warning '復旧後は必ず: powershell -File scripts\rollback.ps1 -ToLatest'
