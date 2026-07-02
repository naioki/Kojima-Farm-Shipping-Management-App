# デプロイ手順（Cloud Run）

このアプリは **Next.js standalone を 1 コンテナ**で動かす（`.claude/rules/stack.md` 準拠）。
ポイントは「**実行時に渡すシークレットは 1 つだけ**」にしてあること。残りはデプロイ後に
`/admin/settings` から入力できる（`lib/settings.ts` が DB(`app_settings`)→env の順に解決する）。

## 渡す値は 3 つだけ

| 値 | 渡し方 | 秘匿性 | 理由 |
|----|--------|--------|------|
| `NEXT_PUBLIC_SUPABASE_URL` | ビルド時 `--build-arg` | 非秘匿 | クライアントバンドルに焼き込まれる。RLS 前提でブラウザに配布される公開値 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ビルド時 `--build-arg` | 非秘匿 | 同上（anon キーは RLS で保護される公開鍵） |
| `SUPABASE_SERVICE_ROLE_KEY` | 実行時 Secret Manager | **秘匿** | admin クライアントが `app_settings` を読むのに使う。これ自体は設定テーブルに置けない（鶏卵） |

**それ以外**（`GEMINI_API_KEY`・`R2_*`・通知系・`GEMINI_MODEL` など）は、デプロイ後に管理者で
`/admin/settings` を開いて入力する。再デプロイ不要。

> セキュリティ: `SUPABASE_SERVICE_ROLE_KEY` の値は **Secret Manager だけ**に置く。
> 環境変数直書き・コード埋め込み・コミットは禁止（`.claude/rules/security.md`）。

---

## 初回セットアップ（1 回だけ）

```bash
PROJECT=kojima-farm
REGION=asia-northeast1

gcloud config set project "$PROJECT"

# 必要 API（run / cloudbuild / artifactregistry は有効済み。secretmanager を追加）
gcloud services enable secretmanager.googleapis.com

# Artifact Registry リポジトリ（イメージ置き場）
gcloud artifacts repositories create kojima-noen \
  --repository-format=docker --location="$REGION" \
  --description="kojima-noen app images" || true

# service_role キーをシークレット化（値はあなたが貼り付ける。私=Claude は値を扱わない）
printf '%s' 'ここに service_role キーを貼る' | \
  gcloud secrets create supabase-service-role --data-file=- --replication-policy=automatic
# 既にある場合は新バージョン追加:
#   printf '%s' '...' | gcloud secrets versions add supabase-service-role --data-file=-

# Cloud Build / Cloud Run のサービスアカウントにシークレット読み取りを許可
PROJ_NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding supabase-service-role \
  --member="serviceAccount:${PROJ_NUM}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

# Cloud Build SA に Run デプロイ権限（cloudbuild.yaml で deploy する場合）
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJ_NUM}@cloudbuild.gserviceaccount.com" \
  --role=roles/run.admin
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${PROJ_NUM}@cloudbuild.gserviceaccount.com" \
  --role=roles/iam.serviceAccountUser
```

---

## 毎回のデプロイ

`cloudbuild.yaml` を使う（ビルド→push→deploy を一括）。`NEXT_PUBLIC_*` は substitution で渡す。

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=\
_NEXT_PUBLIC_SUPABASE_URL=https://ggenmkcdwzpydbkpxpms.supabase.co,\
_NEXT_PUBLIC_SUPABASE_ANON_KEY=ここに anon キー
```

完了後、Cloud Run の URL が表示される。初回はそのまま開いて `/admin/settings` で
`GEMINI_API_KEY` などを入力すれば取込・通知などが有効になる。

---

## デプロイ後チェック

1. トップ（`/admin`）が表示され、ログインできる。
2. `/admin/settings` で `SUPABASE_SERVICE_ROLE_KEY` が「設定済み」と出る（= シークレット注入成功）。
3. `GEMINI_API_KEY` を入力 → `/admin/master-import` で写真取込が動く。
4. 新しい migration を入れた場合は本番 Supabase(ref `ggenmkcdwzpydbkpxpms`)にも適用する。

## ロールバック

Cloud Run のリビジョンで戻すのが基本（各リビジョンはデプロイ時のイメージを保持しているため、
Artifact Registry の `:latest` タグが上書きされていても影響しない）:

```bash
gcloud run revisions list --service=kojima-farm-order-app --region=asia-northeast1
gcloud run services update-traffic kojima-farm-order-app --region=asia-northeast1 \
  --to-revisions=<安定リビジョン>=100
```

**トラフィック固定の罠**: 上記でロールバックした後、`--to-revisions` で特定リビジョンに
100%固定されたままだと、次回の通常デプロイが `serving 0 percent of traffic` のまま反映されない。
ロールバック後に平常運用へ戻すときは必ず `--to-latest` に戻すこと:

```bash
gcloud run services update-traffic kojima-farm-order-app --region=asia-northeast1 --to-latest
```

イメージそのものから再デプロイしたい場合（Cloud Run のリビジョンが消えている等）は、
`cloudbuild.yaml` が `:latest` に加えて `:$BUILD_ID`（ビルドごとに一意）でも push しているので、
Artifact Registry で過去の `:$BUILD_ID` を確認し、そのイメージを直接指定して deploy できる:

```bash
gcloud artifacts docker images list asia-northeast1-docker.pkg.dev/$PROJECT/kojima-noen/app
gcloud run deploy kojima-farm-order-app \
  --image=asia-northeast1-docker.pkg.dev/$PROJECT/kojima-noen/app:<過去のBUILD_ID> \
  --region=asia-northeast1
```
