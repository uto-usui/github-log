---
name: analyze-prs
description: GitHub のマージ済み PR を期間指定で取得して LLM で要約・分類・インサイト生成し、Slack と Notion の作業ログに投稿する。実行者がアサインされた Issue/PR、レビュー依頼、PR 本文から抽出した残タスクも一緒に出す。トリガー — 「PR を分析」「週次レポート」「マージした PR をまとめて」「先週/先月の PR を振り返る」「analyze-prs」「作業ログを書く」「PR から Issue 化候補を出す」。github-log リポジトリ前提（env / out/ ディレクトリ / gh CLI が揃っている環境）。
---

# Analyze PRs

## 設計原則

1. **社内公開前提**: 実行者個人のプライベートな内容（家族・健康・休暇・私的なサイドプロジェクト名など）が混入していた場合は **必ず除外** し、ビジネスとしての成果と文脈だけを残す。
2. **対象は Organization のみ**: 個人リポジトリの PR は `GITHUB_ORG` で必ず弾く。これを忘れると個人プロジェクトが混入する。
3. **推論で完結させる**: コンテキスト・関連性・次のアクションは PR 本体／差分／コミット／関連 Issue／外部目標から **推論で抽出する**。`AskUserQuestion` で実行者に選択肢を提示して埋めさせるのは **禁止**。情報不足のときは「推論できなかった」と明示し、空欄のまま進める。

## 環境変数

必須 / 任意の全リストは `README.md` を参照。本 skill が特に依存するのは:

- `GITHUB_ORG` — 必須。これに属さないリポジトリの PR は集計しない（個人プロジェクト混入防止）
- `NOTION_DATABASE_URL` — 任意。未設定なら Notion 投稿はスキップ
- `GOALS_REPO` + `GOALS_PATHS` — 任意。両方セットされたときだけ外部目標を取得（5. 参照）

## 使い方

引数なし → 前回の分析終了日の翌日〜今日（初回は 7 日間）。
引数あり → 指定した日数（前回の終了日は無視）。

## ワークフロー

### 1. 期間の決定

**引数あり**:

```bash
SINCE_DATE=$(date -v-${DAYS}d +%Y-%m-%d)   # macOS
TODAY=$(date +%Y-%m-%d)
```

**引数なし**:

1. `out/analysis_*.json` を Glob で検索し、最新ファイルを Read
2. `meta.period.to` を取得し、翌日を `SINCE_DATE` に設定
   - macOS: `date -j -v+1d -f "%Y-%m-%d" "<前回のto>" +%Y-%m-%d`
3. 該当ファイルがなければ初回扱いで 7 日前を `SINCE_DATE` とする
4. `SINCE_DATE == TODAY` のときは「前回の分析が今日のため、新しい PR はありません」と報告して終了

### 2. PR リストの取得

事前に `gh auth status` を確認。失敗時は `gh auth login` を案内して停止。

```bash
gh search prs \
  --author=@me \
  --owner=${GITHUB_ORG} \
  --merged-at=${SINCE_DATE}..${TODAY} \
  --json number,title,url,closedAt,repository,labels,body \
  --limit 100
```

**注意**:
- `--owner=${GITHUB_ORG}` は必須。取得後に `repository.nameWithOwner` のプレフィックスを再確認
- 0 件のときは「指定期間にマージされた PR は見つかりませんでした」と報告し、JSON も Slack も作らずに終了

### 3. 各 PR の詳細取得

各 PR について以下を 1 コールで取得する（複数フィールドを `--json` にカンマ区切りで並べる）：

```bash
gh pr view {PR番号} --repo {owner/repo} \
  --json commits,files,reviews,reviewRequests,body
```

**並列指示**: 複数 PR を処理するときは、**1 メッセージ内で Bash ツール呼び出しを複数並列に発行する**。逐次実行ではなく一括 fan-out にすること。Step 2 の `gh search prs` と Step 5 の外部目標 fetch も独立しているので、可能なら同じメッセージ内で並列発行できる。

### 4. PR body から構造化情報を抽出

PR 本文に含まれる残タスク・関連性・背景を検出する。検出パターンの詳細は [references/extraction.md](references/extraction.md) を参照。

### 5. 外部目標の取得（`GOALS_REPO` + `GOALS_PATHS` 設定時のみ）

`GOALS_PATHS` をカンマで split し、**各 path に対して `gh api` を 1 メッセージ内で並列発行**する：

```bash
gh api "repos/${GOALS_REPO}/contents/<path>" --jq '.content' | base64 -d
```

取得した Markdown はそのまま LLM 分析の文脈に渡す。構造化抽出はしない。取得失敗（404 / 認証エラー）は警告だけ出して処理は続行。

社内公開向けのフィルタ・Obsidian Wikilink の扱い・目標構造の推論手がかりは [references/extraction.md](references/extraction.md) を参照。

### 6. LLM による分析

取得データを以下の観点で分析・要約する：

1. **期間サマリー** — 総 PR 数、主な作業領域、期間中の主要成果
2. **PR 分類** — feat / fix / refactor / docs / other
3. **各 PR の要約** — タイトルと目的、主な変更（コミット推測）、影響範囲
4. **インサイト** — 作業パターンの傾向、注目すべき変更、技術的ハイライト
5. **コンテキストの抽出**（すべて推論で、`AskUserQuestion` 禁止）

   PR 本体・コミット・変更ファイル・body 内の `#123` 参照・「概要 / 背景 / 目的」セクション・「〜の続き」「〜を前提に」表現・取得済み外部目標 Markdown から推論する。

6. **次のアクションの抽出**

   **A. アサインされた Issue/PR / レビュー依頼を取得**（いずれも `${GITHUB_ORG}` 限定、**3 件は独立しているので 1 メッセージ内で並列発行する**）:

   ```bash
   # 自分にアサインされたオープン Issue
   gh search issues --assignee=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 20

   # 自分が作者のオープン PR
   gh search prs --author=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 20

   # レビューリクエストされた PR（個人宛のみ、チーム経由は除外）
   gh search prs --review-requested=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 10
   ```

   レビュー依頼 PR は Step 3 で取得済みの `reviewRequests` を再利用し、`reviewRequests[].{__typename, login}` で `User` かつ自分の `login` があるものだけ採用（`Team` のみは除外）。

   **B. PR から残タスクを自動抽出** — 4. の検出パターンを使う

   **C. Issue 化の提案** — PR から抽出した残タスクのうち Issue 化されていないものは「Issue 作成を提案」として記載。形式: `- [ ] [提案] {内容} → Issue作成を推奨`

   **D. 実行者に質問しない** — アサイン Issue/PR・レビュー依頼・PR 内残タスクから機械的に抽出し、推論で補完する。判断が割れる項目は載せない方が良い。

### 7. 結果の保存

`out/` に JSON と Markdown を両方保存：

```
out/analysis_{SINCE_DATE}_to_{TODAY}.json   # 構造化データ
out/analysis_{SINCE_DATE}_to_{TODAY}.md     # 人間が読む用
```

JSON 構造と Markdown テンプレートの完全仕様は [references/output-formats.md](references/output-formats.md) を参照。

### 8. Slack 投稿

分析結果を **1 回の投稿で** まとめて Slack に送る。チャンネルは `SLACK_CHANNEL`、認証は `SLACK_TOKEN`。投稿フォーマット・コマンド・文字数制限の扱いは [references/posting.md](references/posting.md#slack) を参照。

### 9. Notion 投稿（`NOTION_DATABASE_URL` 設定時のみ）

新規ページを作成し、同期間の既存ページがあれば削除を案内する方式で行う。`notion-fetch`（DB 構造取得）と `notion-search`（既存ページ確認）は独立しているので **1 メッセージ内で並列発行する**。詳細手順（プロパティ指定、PR 番号のリンク化ルールなど）は [references/posting.md](references/posting.md#notion) を参照。

## エラーハンドリング

| ケース | 対応 |
|---|---|
| `gh auth status` 失敗 | 「`gh auth login` を実行してください」と案内して停止 |
| 前回の分析が今日 | 「新しい PR はありません」と報告。強制実行は `analyze-prs 1` のように日数引数で |
| 期間内 PR が 0 件 | 報告のみ。JSON 作成も Slack 投稿もしない |
| Slack 投稿失敗 | エラーを表示。JSON は保存済みなので手動確認を案内 |
| Slack 40,000 文字超過 | 要約版を投稿、詳細は JSON 参照と案内 |
| `NOTION_DATABASE_URL` 未設定 | Notion 投稿をスキップ、Slack のみ実行 |
| Notion DB アクセス権限なし | エラー内容を表示し、権限確認を案内 |
| Notion MCP 利用不可 | Notion 投稿をスキップ、ローカル JSON/Markdown を参照と案内 |

## 実行例

```
1月25日: PRを分析して        → 1/18〜1/25 を分析（初回、7 日間）
1月28日: PRを分析して        → 1/26〜1/28 を分析（前回の翌日から）
2月1日:  過去30日のPRを分析   → 1/3〜2/1 を分析（前回の終了日を無視）
```
