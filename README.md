# number-picker（クリニック順番待ちシステム）

Vite + React + TypeScript + Supabase で構成した、マルチクリニック対応の順番待ちWebアプリです。

## 主な機能

- **クリニックごとのURL発行**: 管理画面（`/admin`）で初回登録すると、患者様用の固定URL（`/c/:slug`）とQRコードが自動発行されます。
- **受付発券 & 4桁PIN自動生成**: 受付スタッフが発券ボタンを押すと、連番と数字4桁のランダムPINを発行します。
- **番号リセット機能**: 管理画面の「番号を1番にリセット」ボタンで、午前・午後など好きなタイミングで1番からやり直せます。
- **リアルタイム更新 & RLS保護**: `tickets` テーブルへの直接アクセスはログイン済み自院スタッフのみに制限し、患者様は公開サマリー（`clinic_queue_state`）の Realtime 通知＋照合RPC（`verify_ticket`）で「あと何人待ちか」を安全に自動更新します。

## セットアップ手順

### 1. Supabase プロジェクトの準備
1. [Supabase](https://supabase.com/) で無料プロジェクトを作成します。
2. 左メニューの **SQL Editor** を開き、`supabase/schema.sql` の内容をすべて貼り付けて **Run** を実行します。
3. **Project Settings → API** から `Project URL` と `anon public` キーを控えます。

### 2. ローカル環境での起動
```bash
pnpm install
cp .env.example .env.local
# .env.local に VITE_SUPABASE_URL と VITE_SUPABASE_ANON_KEY を記入
pnpm dev
```

### 3. 動作確認フロー
1. `http://localhost:5173/admin` を開き、新規アカウント登録 → ログインします。
2. クリニック名とURLスラッグ（例: `sakura-clinic`）を登録します。
3. 「＋ 新しい番号を発券」を押し、表示された **受付番号** と **4桁PIN** を確認します。
4. 右側の「患者画面をプレビュー」または QRコードから `/c/sakura-clinic` を開き、番号とPINを入力してリアルタイム更新を確認します。

## 無料から有料への移行ポイント
- Supabase の無料プランは一定期間アクセスがないとプロジェクトが自動停止します。本番運用へ移る際に Pro プランへ切り替えるだけで、ソースコードを変更せずに継続稼働・バックアップ・同時接続数拡張へ移行できます。
- フロントエンドは `pnpm build` で静的ファイル（`dist/`）が生成されるため、Vercel や Cloudflare Pages へそのままデプロイできます（`vercel.json` と `public/_redirects` に SPA ルーティング設定を含めています）。
