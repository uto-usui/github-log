---
allowed-tools: [Read, Write, Bash, Glob, WebFetch, AskUserQuestion, mcp__notion__notion-fetch, mcp__notion__notion-create-pages]
description: PRデータをLLMで分析・要約し、コミットログも深掘りしてSlack・Notionに投稿
---

# Analyze PRs コマンド

マージされたPRを分析し、LLMによる要約とインサイトを生成してSlackとNotionに投稿するコマンドです。

## 使用方法

```bash
/project:analyze-prs [日数]
```

- 引数なし: **前回の分析終了日から今日まで**（初回は7日間）
- 引数あり: 指定した日数（前回の終了日は無視）

**ポイント**: 引数なしで実行すれば、前回のログと重複せず連続したログが取得できる。

## 実行手順

### 1. 環境変数の確認

`.env` ファイルから以下の環境変数を確認：
- `GITHUB_TOKEN`
- `GITHUB_USER_NAME`
- `SLACK_TOKEN`
- `SLACK_CHANNEL`
- `NOTION_DATABASE_URL` - 作業ログデータベースのURL（例: `https://www.notion.so/note-jp/2f3880bd573580f08a49ed92c6b7ccfd`）

### 2. PRデータの取得

`gh` CLIを使用してPRデータを取得します。

**重要**: 実行前に `gh auth status` で認証状態を確認すること。

#### 2.1 期間の決定

**引数がある場合**: 指定した日数を使用

```bash
# 日付計算（macOS）
DAYS=${ARGUMENTS}
SINCE_DATE=$(date -v-${DAYS}d +%Y-%m-%d)
TODAY=$(date +%Y-%m-%d)
```

**引数がない場合**: 前回の分析終了日から今日まで

```bash
# 1. out/ディレクトリから最新の分析ファイルを検索
#    ファイル名形式: analysis_{SINCE_DATE}_to_{TODAY}.json
ls -t out/analysis_*.json | head -1

# 2. 最新ファイルのJSONから終了日（meta.period.to）を取得
#    例: "to": "2026-01-25" → SINCE_DATE="2026-01-25"

# 3. 前回の終了日の翌日を開始日として使用
#    macOS: date -j -v+1d -f "%Y-%m-%d" "2026-01-25" +%Y-%m-%d
#    → SINCE_DATE="2026-01-26"

# 4. ファイルが存在しない（初回実行）場合は7日間をデフォルトとする
```

**実装例**（Claudeが実行）:
```
1. Glob で out/analysis_*.json を検索
2. 最新ファイルを Read して meta.period.to を取得
3. 翌日を SINCE_DATE として設定
4. ファイルがなければ SINCE_DATE = 7日前
```

#### 2.2 PRリストの取得

```bash
TODAY=$(date +%Y-%m-%d)

# PRリストを取得（--merged-at で日付範囲を指定）
gh search prs --author=@me --merged-at=${SINCE_DATE}..${TODAY} --json number,title,url,closedAt,repository,labels,body --limit 100
```

**注意**:
- `--merged` はboolean型のフラグ。日付範囲を指定するには `--merged-at` を使用
- Linux環境では `date -d "-${DAYS} days" +%Y-%m-%d` を使用
- 前回の終了日と今日が同じ場合は「新しいPRはありません」と報告

### 3. 各PRの詳細データを取得

取得した各PRについて、以下の追加情報を `gh` で取得。**並列実行を推奨**（効率化のため）。

```bash
# コミットログと変更ファイルを同時に取得（1コマンドで両方取れる）
gh pr view {PR番号} --repo {owner/repo} --json commits,files

# レビューコメント（必要に応じて）
gh pr view {PR番号} --repo {owner/repo} --json reviews
```

**Tips**:
- 複数のPRを処理する場合、Bashツールを並列で呼び出すとAPI待ち時間を短縮できる
- `--json commits,files` のようにカンマ区切りで複数フィールドを一度に取得可能

### 3.5. PRのbodyから情報を自動抽出

PRの `body`（説明文）には構造化された情報が含まれていることが多い。以下のパターンを検出して抽出する：

**残タスク・TODOの検出パターン**:
```
- 「## 残タスク」「## 🔜 残タスク」セクション
- 「- [ ]」形式のチェックリスト（未完了のもの）
- 「〜は別PRで対応」「〜は後で実装」などの表現
- 「TODO:」「FIXME:」を含む行
```

**PR間の関連性の検出パターン**:
```
- 「#123」形式のPR/Issue参照
- 「〜の続き」「〜を前提に」「〜に依存」などの表現
- 「Related:」「Depends on:」「Blocks:」などのセクション
```

**背景・目的の検出パターン**:
```
- 「## 概要」「## 背景」「## 目的」「## Why」セクション
- 「## 📝 概要」などの絵文字付きセクション
```

**コード内TODOの検出**（重要なファイルのみ）:
```bash
# 変更されたファイルからTODO/FIXMEを検出
gh pr view {PR番号} --repo {owner/repo} --json files -q '.files[].path' | \
  xargs -I {} sh -c 'grep -n "TODO:\|FIXME:" {} 2>/dev/null || true'
```

### 4. LLMによる分析

取得したデータを以下の観点で分析・要約：

1. **期間サマリー**
   - 総PR数、主な作業領域
   - 期間中の主要な成果

2. **PR分類**
   - 機能追加（feat）
   - バグ修正（fix）
   - リファクタリング
   - ドキュメント
   - その他

3. **各PRの要約**
   - タイトルと目的
   - 主な変更内容（コミットログから推測）
   - 影響範囲

4. **インサイト**
   - 作業パターンの傾向
   - 注目すべき変更
   - 技術的なハイライト

5. **コンテキスト（文脈）の抽出と対話**

   **自動抽出**（PRのbody/コミットから）:
   - PR同士の **関連性**: bodyに含まれる `#123` 形式の参照を検出
   - **背景・目的**: bodyの「概要」「背景」「目的」セクションから抽出
   - **依存関係**: 「〜の続き」「〜を前提に」などの表現を検出

   **ユーザーへの質問**（自動抽出できない場合）:
   ```
   AskUserQuestionを使用して以下を確認:
   - 「この期間の作業は、どの目標・OKRに貢献していますか？」
   - 「特に関連が深いPR同士はありますか？」
   - 「この期間に作業した背景・きっかけは何ですか？」
   ```

6. **次のアクションの抽出と対話**

   **A. アサインされたPR/Issueを取得**:
   ```bash
   # 自分にアサインされたオープンなIssue
   gh issue list --assignee @me --state open --json number,title,url,repository --limit 20

   # 自分にアサインされたオープンなPR
   gh pr list --author @me --state open --json number,title,url,repository --limit 20

   # レビューリクエストされたPR
   gh pr list --search "review-requested:@me" --state open --json number,title,url,repository --limit 10
   ```

   **B. PRから残タスクを自動抽出**:
   - 「残タスク」「TODO」「🔜」「次のステップ」セクションを検出
   - 「〜は別PRで対応」「〜は後で」などの表現を検出
   - コミットメッセージの `TODO:` `FIXME:` を検出

   **C. Issue化の提案**:
   - PRから抽出した残タスクのうち、Issueが作成されていないものは **「Issue作成を提案」** として記載
   - 形式: `- [ ] [提案] {内容} → Issue作成を推奨`

   **コード解析**（必要に応じて）:
   - 変更されたファイルに `// TODO:` `// FIXME:` があれば抽出
   - 特に重要な変更（Dockerfile、CI/CD設定など）は内容を確認

   **ユーザーへの質問**（確認・補完）:
   ```
   AskUserQuestionを使用:
   - 「抽出した次のアクションを確認してください。追加・修正はありますか？」
   - 「技術的負債として認識しているものはありますか？」
   - 「次週に継続する予定の作業はありますか？」
   ```

### 5. 結果の保存

分析結果を `out/` ディレクトリに保存（JSONとMarkdown両方）：

```
out/analysis_{SINCE_DATE}_to_{TODAY}.json   # 構造化データ（プログラム処理用）
out/analysis_{SINCE_DATE}_to_{TODAY}.md     # 人間が読みやすい形式（レビュー用）
```

**Note**: `out/` ディレクトリは `.gitignore` に含まれているため、これらのファイルはコミットされません。

#### 5.1 JSON構造
```json
{
  "meta": {
    "analyzedAt": "2026-01-25T10:30:00Z",
    "analyzedBy": "uto-usui",
    "period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "days": 7 }
  },
  "summary": "期間の要約テキスト",
  "totalPRs": 10,
  "categories": {
    "feat": [...],
    "fix": [...],
    "refactor": [...],
    "docs": [...],
    "other": [...]
  },
  "prs": [
    {
      "number": 123,
      "title": "...",
      "url": "...",
      "repository": "owner/repo",
      "closedAt": "...",
      "summary": "LLMによる要約",
      "commits": 5,
      "filesChanged": [...],
      "relatedPRs": [122, 124]  // 関連するPR番号（あれば）
    }
  ],
  "insights": "LLMによるインサイト",
  "context": {
    "quarterlyGoals": ["MCP基盤のリモート化", "非エンジニア向けDX改善"],
    "prRelationships": [
      {
        "parent": 587,
        "child": 593,
        "relationship": "#587で基盤構築 → #593でセッション管理追加"
      }
    ],
    "background": "なぜこの期間にこれらの作業を行ったかの背景"
  },
  "nextActions": {
    "assignedIssues": [
      {
        "number": 123,
        "title": "MCPログ収集機能の実装",
        "url": "https://github.com/pocake/note-ui/issues/123",
        "repository": "pocake/note-ui"
      }
    ],
    "assignedPRs": [
      {
        "number": 456,
        "title": "feat: add logging middleware",
        "url": "https://github.com/pocake/note-ui/pull/456",
        "repository": "pocake/note-ui"
      }
    ],
    "reviewRequested": [],
    "extractedFromPRs": [
      {
        "type": "followup",
        "description": "Terraform側でECRリソースを作成",
        "relatedPR": 587,
        "suggestIssue": true
      }
    ],
    "userInput": [
      {
        "type": "continue",
        "description": "palette MCPの監視体制整備",
        "relatedPR": 587
      },
      {
        "type": "new",
        "description": "MCPのアクセス/使用ログ収集の仕組み作成",
        "relatedPR": null
      }
    ]
  }
}
```

#### 5.2 Markdown形式

人間が読みやすいMarkdown形式でも保存。後から振り返りやすい構造にする：

```markdown
# PR分析レポート: {SINCE_DATE} 〜 {TODAY}

> 分析日時: {analyzedAt}
> 分析者: {analyzedBy}
> 期間: {days}日間

## 📝 サマリー

{期間の要約}

## 📈 統計

| カテゴリ | 件数 |
|---------|------|
| 総PR数 | {totalPRs} |
| feat | {feat数} |
| fix | {fix数} |
| refactor | {refactor数} |
| docs | {docs数} |
| other | {other数} |

## 🔖 PR一覧

### {リポジトリ名1}

#### [{PR番号}] {タイトル}
- **マージ日**: {closedAt}
- **コミット数**: {commits}
- **変更ファイル**: {filesChanged}
- **要約**: {LLMによる要約}
- **URL**: {url}

{関連PRがあれば}
- **関連PR**: #{relatedPR1}, #{relatedPR2}

---

## ⭐ 主なハイライト

{この期間の特筆すべき成果}

## 🔧 技術トピック

{使用された技術・ツール・パターンの傾向}

## 💡 インサイト

{LLMによる分析コメント}

---

## 🎯 目標との関連

### 四半期目標
{quarterlyGoals をリスト形式で}

### PR間の関係性
{prRelationships を説明形式で}

### 背景
{background}

## ➡️ 次のアクション

### アサインされたIssue
{assignedIssues をチェックリスト形式で}

### アサインされたPR
{assignedPRs をチェックリスト形式で}

### レビュー待ち
{reviewRequested をチェックリスト形式で}

### 継続・フォローアップ
{extractedFromPRs + userInput をチェックリスト形式で}

### [提案] Issue作成を推奨
{suggestIssue: true のものをリスト形式で}
```

### 6. Slackへの投稿

分析結果をSlackに **1回の投稿で** まとめて投稿。

投稿形式：
```
📊 *PR分析レポート ({SINCE_DATE} 〜 {TODAY})*

*📝 サマリー*
{期間の要約}

*📈 統計*
- 総PR数: {数}
- feat: {数} / fix: {数} / refactor: {数} / docs: {数} / other: {数}

*🔖 PR一覧*
1. *{タイトル}* ({リポジトリ名})
   - {LLMによる1行要約}
   - 🔗 {URL}
2. ...

*⭐ 主なハイライト*
{この期間の特筆すべき成果や重要な変更点}

*🔧 技術トピック*
{使用された技術・ツール・パターンの傾向}

*💡 インサイト*
{LLMによる分析コメント}

---

*🎯 目標との関連*
{この期間の作業がどの目標・OKRに貢献しているか}

*➡️ 次のアクション*

*アサインされたIssue/PR*
- [ ] #{番号} {タイトル} 🔗 {URL}

*レビュー待ち*
- [ ] #{番号} {タイトル} 🔗 {URL}

*継続・フォローアップ*
- [ ] {内容} (関連: #{PR番号})

*[提案] Issue作成を推奨*
- [ ] {PRから抽出した残タスク} → Issue化推奨
```

**ポイント**:
- PR一覧は必ずリンク付きで、後から参照しやすく
- 「主なハイライト」で特筆すべき成果を強調、「技術トピック」で技術的傾向を可視化
- インサイトの後に区切り線（---）を入れて、目標との関連・次アクションを追加
- 1回の投稿に全てまとめることで、スクロールせずに全体像が把握できる
- アサインされたIssue/PRは「今やるべきこと」として最優先表示
- PRから抽出した残タスクは「Issue化を提案」として可視化

Slack投稿には以下のコマンドを使用：

```bash
curl -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer ${SLACK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"channel": "${SLACK_CHANNEL}", "text": "..."}'
```

### 7. Notionへの投稿

分析結果をNotionの「作業ログ」データベースに保存。後から検索・振り返りがしやすい形式で記録。

#### 7.1 データベース情報の取得

`.env`の`NOTION_DATABASE_URL`を使用してデータベース構造を取得：

```
mcp__notion__notion-fetch を使用:
- id: ${NOTION_DATABASE_URL}
```

レスポンスから `data_source_id` を抽出（`collection://` 形式のURL）。

#### 7.2 ページの作成

`mcp__notion__notion-create-pages` を使用してレポートを追加：

```json
{
  "parent": {
    "data_source_id": "{取得したdata_source_id}"
  },
  "pages": [
    {
      "properties": {
        "Name": "PR分析レポート: {SINCE_DATE} 〜 {TODAY}"
      },
      "content": "{Markdownファイルの内容}"
    }
  ]
}
```

#### 7.3 Notion Markdown形式のポイント

- **テーブル**: 標準Markdown形式がそのまま使える
- **チェックリスト**: `- [ ]` 形式がそのまま使える
- **見出し**: `##` 形式がそのまま使える
- **引用**: `>` 形式がそのまま使える
- **区切り線**: `---` がそのまま使える

**Note**: Notionはページタイトルを自動で表示するため、contentの先頭に `# タイトル` は不要。

## エラーハンドリング

### gh認証エラー
```bash
# 事前チェック
gh auth status
# 失敗した場合: 「gh auth login を実行してください」と案内
```

### 前回の分析が今日の場合
- 「前回の分析が今日（{日付}）のため、新しいPRはありません」と報告
- 分析をスキップ
- 強制的に実行したい場合は日数を引数で指定（例: `/analyze-prs 1`）

### PRが見つからない場合
- 「指定期間（{SINCE_DATE} 〜 {TODAY}）にマージされたPRは見つかりませんでした」と報告
- JSONファイルは作成しない
- Slack投稿もスキップ

### Slack投稿失敗
- エラー内容を表示（認証エラー、チャンネル不正など）
- JSONファイルは保存済みなので、手動で確認可能と案内

### Slack文字数制限
- Slackのメッセージ上限は約40,000文字
- PR数が多い場合は要約版を投稿し、詳細はJSONファイルを参照と案内

### Notion投稿失敗
- `NOTION_DATABASE_URL`が未設定の場合: Notion投稿をスキップし、Slack投稿のみ実行
- データベースへのアクセス権限がない場合: エラー内容を表示し、権限確認を案内
- MCPツールが利用できない場合: Notion投稿をスキップし、ローカルファイル（JSON/Markdown）を参照と案内

## 実行例

```bash
# 前回の分析終了日から今日まで（推奨）
# 例: 前回が1/25終了 → 1/26〜今日のPRを取得
/project:analyze-prs

# 過去30日間のPRを分析（前回の終了日を無視）
/project:analyze-prs 30

# 初回実行時は自動的に過去7日間を取得
```

**継続的な運用例**:
```
1月25日: /analyze-prs      → 1/18〜1/25 を分析（初回、7日間）
1月28日: /analyze-prs      → 1/26〜1/28 を分析（前回の翌日から）
2月1日:  /analyze-prs      → 1/29〜2/1  を分析（前回の翌日から）
```
