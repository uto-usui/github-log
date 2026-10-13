---
name: analyze-prs
description: GitHub の PR を期間指定で取得して LLM で要約・分類・インサイト生成し、Slack と Notion の作業ログに投稿する。マージ済みだけでなく「作業中（open かつ期間内にコミットあり）」の PR も作業実績として集計する。実行者がアサインされた Issue/PR、レビュー依頼、PR 本文から抽出した残タスクも一緒に出す。トリガー — 「PR を分析」「週次レポート」「マージした PR をまとめて」「先週/先月の PR を振り返る」「analyze-prs」「作業ログを書く」「PR から Issue 化候補を出す」。github-log リポジトリ前提（env / out/ ディレクトリ / gh CLI が揃っている環境）。
---

# Analyze PRs

## 設計原則

1. **社内公開前提**: 実行者個人のプライベートな内容（家族・健康・休暇・私的なサイドプロジェクト名など）が混入していた場合は **必ず除外** し、ビジネスとしての成果と文脈だけを残す。
2. **対象は Organization のみ**: 個人リポジトリの PR は `GITHUB_ORG` で必ず弾く。これを忘れると個人プロジェクトが混入する。
3. **推論で完結させる**: コンテキスト・関連性・次のアクションは PR 本体／差分／コミット／関連 Issue／外部目標から **推論で抽出する**。`AskUserQuestion` で実行者に選択肢を提示して埋めさせるのは **禁止**。情報不足のときは「推論できなかった」と明示し、空欄のまま進める。
4. **成果はマージ済みだけではない**: その週の作業実績は「マージ済み PR」＋「作業中 PR（open かつ期間内にコミットあり）」。未マージでも数十コミット・数千行の作業が入ることがあり、マージ済みだけ数えると週の最大の塊を落とす。作業中 PR を「次のアクション」の TODO に流し込まない。
5. **件数を silent に切らない**: `--limit` で結果が truncate されたまま件数を書くと、レポートが実態より小さく見える。実数を数えたうえで「全 N 件中の抜粋」と明記する。

## 環境変数

必須 / 任意の全リストは `README.md` を参照。本 skill が特に依存するのは:

- `GITHUB_ORG` — 必須。これに属さないリポジトリの PR は集計しない（個人プロジェクト混入防止）
- `NOTION_DATABASE_URL` — 任意。未設定なら Notion 投稿はスキップ
- `GOALS_REPO` + `GOALS_PATHS` — 任意。両方セットされたときだけ外部目標を取得（5. 参照）

## 使い方

引数なし → 前回の分析終了日〜今日（初回は 7 日間）。前回の終了日は重ねて取り、前回計上済みの PR を除く。
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
2. `meta.period.to` を **そのまま** `SINCE_DATE` に設定する（翌日にしない）
3. 前回 JSON の `prs[].number` を「前回計上済み」、`inProgressPRs[].number` を「前回作業中」として控えておく
4. 該当ファイルがなければ初回扱いで 7 日前を `SINCE_DATE` とする
5. `SINCE_DATE == TODAY` のときは「前回の分析が今日のため、新しい PR はありません」と報告して終了

**前回の終了日を重ねる理由**: 前回の分析は終了日の途中で走るので、その日の分析後にマージされた PR は、翌日始まりにすると前回にも今回にも入らない（実例: 2 回続けて 3 件ずつ漏れた）。重ねて取ったうえで次のように扱う:

- 前回計上済み（`prs[]` にある）PR はマージ済み一覧から除く
- 前回作業中（`inProgressPRs[]` にある）でその後マージされた PR は、今回のマージ済みに数え、「前回作業中として計上済み」と注記する
- 期間内コミットは `authoredDate >= SINCE_DATE` のまま数える（Step 3 参照）。前回の終了日のコミットは前回と重なりうるが、1 日分なので数え直さない

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

**あわせて「作業中 PR」も必ず取得する**（同じメッセージ内で並列発行）:

```bash
gh search prs \
  --author=@me \
  --owner=${GITHUB_ORG} \
  --state=open \
  --updated=${SINCE_DATE}..${TODAY} \
  --json number,title,url,repository,createdAt,updatedAt,isDraft \
  --limit 50
```

**注意**:
- `--owner=${GITHUB_ORG}` は必須。取得後に `repository.nameWithOwner` のプレフィックスを再確認
- **マージ済みだけを成果と数えない。** その週の作業実績は「マージ済み PR」＋「作業中 PR（open かつ期間内にコミットあり）」の両方。未マージでも 30 コミット超・数千行規模の作業が入ることがあり、マージ済みだけ見ると週の最大の塊を落とす
- マージ済み 0 件でも作業中 PR があればレポートを作る。**両方 0 件のときだけ**「指定期間に対象の PR は見つかりませんでした」と報告して終了
- `--merged-at` の検索はレース条件がある。検索実行後にマージされた PR は入らない。**レポート確定の直前に `--merged-at` を再実行して差分がないか確認する**こと（実例: 検索の 24 分後にマージされた PR を取りこぼした）

### 3. 各 PR の詳細取得

マージ済み PR・作業中 PR の**両方**について以下を 1 コールで取得する（複数フィールドを `--json` にカンマ区切りで並べる）：

```bash
gh pr view {PR番号} --repo {owner/repo} \
  --json commits,files,reviews,reviewRequests,body,isDraft
```

**作業中 PR は「期間内のコミット」だけを数える**。`commits[].authoredDate >= SINCE_DATE` でフィルタし、`期間内コミット数 / 全コミット数` の形で持つ。期間前から続いている PR は、その週にやった分だけが実績。

```bash
jq '[.commits[] | select(.authoredDate >= "'${SINCE_DATE}'")] | length'
```

`committedDate` は使わない。rebase すると全コミットの `committedDate` が rebase した時刻に書き換わるので、期間前の作業が期間内に数えられる（実例: stack を rebase した週に、実際は 26 のコミットが 101 と出た）。`authoredDate` で数えても、期間内のコミットが「下の層の変更を伝播しただけ」の stack は、PR ごとに並べず 1 行にまとめる。

**並列指示**: 複数 PR を処理するときは、**1 メッセージ内で Bash ツール呼び出しを複数並列に発行する**。逐次実行ではなく一括 fan-out にすること。Step 2 の `gh search prs` 2 本と Step 5 の外部目標 fetch も独立しているので、可能なら同じメッセージ内で並列発行できる。

### 4. PR body から構造化情報を抽出

PR 本文に含まれる残タスク・関連性・背景を検出する。検出パターンの詳細は [references/extraction.md](references/extraction.md) を参照。

### 5. 外部目標の取得（`GOALS_REPO` + `GOALS_PATHS` 設定時のみ）

`GOALS_PATHS` をカンマで split し、**各 path に対して `gh api` を 1 メッセージ内で並列発行**する：

```bash
gh api "repos/${GOALS_REPO}/contents/<path>" --jq '.content' | base64 -d
```

取得した Markdown はそのまま LLM 分析の文脈に渡す。構造化抽出はしない。

**404 のときは警告して続行しない。実パスを確定させてから取得する。** 目標セクションは分析の骨格なので、黙って空にすると「今週の作業が目標にどう効いたか」が丸ごと落ちる（認証エラーのみ警告して続行でよい）。`GOALS_REPO` はローカルに clone されているのが通常なので、**そこを正としてパスを確定させる**：

```bash
# clone 先を特定（remote が GOALS_REPO と一致するディレクトリ）
cd ~/work/uto/obsidian/uto-notebook && git remote -v
# 実パスは git 管理下の表現を使う。ls の出力は使わない
git ls-files 'database/memos/goal-setting/*'
```

`git ls-files` を使うのは、**macOS のファイルシステムが日本語ファイル名を NFD で保持する一方 GitHub API は NFC で扱う**ため。`ls` の出力は見た目が同じでも API では 404 になる。ローカルに clone が無いときだけ `gh api "repos/${GOALS_REPO}/contents/<親ディレクトリ>" --jq '.[].path'` で listing する。

確定したパスが `.env` の `GOALS_PATHS` とずれていたら **`.env` を直す**。レポートに「修正が必要」と書くだけでは次回も同じ 404 を踏む（実例: 2 週連続で同じ指摘だけが残っていた）。

社内公開向けのフィルタ・Obsidian Wikilink の扱い・目標構造の推論手がかりは [references/extraction.md](references/extraction.md) を参照。

### 6. LLM による分析

取得データを以下の観点で分析・要約する：

1. **期間サマリー** — マージ済み PR 数 + 作業中 PR 数、主な作業領域、期間中の主要成果
2. **PR 分類** — feat / fix / refactor / docs / other（マージ済みのみ。作業中は別枠）
3. **各 PR の要約** — タイトルと目的、主な変更（コミット推測）、影響範囲
4. **作業中 PR の要約** — マージ済みと同じ粒度で書く。加えて `期間内コミット数 / 全コミット数`、変更規模（files / additions / deletions）、レビュー状態（approved か / AI レビューのみか）を必ず出す。**approved 済みで放置されているものは「マージ可能」と明示する**
5. **インサイト** — 作業パターンの傾向、注目すべき変更、技術的ハイライト。作業中 PR も対象に含める（未マージでも規模が大きければハイライトに載せる）
6. **コンテキストの抽出**（すべて推論で、`AskUserQuestion` 禁止）

   PR 本体・コミット・変更ファイル・body 内の `#123` 参照・「概要 / 背景 / 目的」セクション・「〜の続き」「〜を前提に」表現・取得済み外部目標 Markdown から推論する。目標との紐づけには**作業中 PR も含める**（`relatedInProgressPRs` として別フィールドに持ち、レポート上は 🚧 を付けて区別する）。

7. **次のアクションの抽出**

   **A. アサインされた Issue/PR / レビュー依頼を取得**（いずれも `${GITHUB_ORG}` 限定、**3 件は独立しているので 1 メッセージ内で並列発行する**）:

   ```bash
   # 自分にアサインされたオープン Issue
   gh search issues --assignee=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 100

   # 自分が作者のオープン PR
   gh search prs --author=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 100

   # レビューリクエストされた PR（個人宛のみ、チーム経由は除外）
   gh search prs --review-requested=@me --owner=${GITHUB_ORG} --state=open --json number,title,url,repository --limit 100
   ```

   **silent truncation を作らない。** `--limit` は 100 にして実数を数え、レポートに抜粋を載せるときは必ず「全 N 件中の抜粋」と件数を明記する（実例: `--limit 20` で 78 件を 20 件と誤記した）。

   **作業中 PR は次のアクションに二重掲載しない。** Step 2 で取得した作業中 PR は「作業実績」なので、`assignedPRs` からは除外し、残った「期間内に一度も更新のない open PR」だけを**長期滞留（棚卸し対象）**として載せる。

   レビュー依頼 PR は Step 3 の取得対象（自分が作者の PR）に含まれないので、`--review-requested` の結果 1 件ずつに `gh pr view --json reviewRequests` を**並列で**打ち直す。`reviewRequests[].{__typename, login}` で `User` かつ自分の `login` があるものだけ採用（`Team` のみは除外）。チーム経由が大半を占めるので、**個人宛 N 件 / 全 M 件**の形で両方出す（実例: 全 37 件のうち個人宛は 2 件だった）。

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
| 期間内のマージ済み PR が 0 件 | 作業中 PR があればそれだけでレポートを作る |
| マージ済みも作業中も 0 件 | 報告のみ。JSON 作成も Slack 投稿もしない |
| Slack 投稿失敗 | エラーを表示。JSON は保存済みなので手動確認を案内 |
| Slack 40,000 文字超過 | 要約版を投稿、詳細は JSON 参照と案内 |
| `NOTION_DATABASE_URL` 未設定 | Notion 投稿をスキップ、Slack のみ実行 |
| Notion DB アクセス権限なし | エラー内容を表示し、権限確認を案内 |
| Notion MCP 利用不可 | Notion 投稿をスキップ、ローカル JSON/Markdown を参照と案内 |

## 実行例

```
1月25日: PRを分析して        → 1/18〜1/25 を分析（初回、7 日間）
1月28日: PRを分析して        → 1/25〜1/28 を分析（前回の終了日から。前回計上済みの PR は除く）
2月1日:  過去30日のPRを分析   → 1/3〜2/1 を分析（前回の終了日を無視）
```
