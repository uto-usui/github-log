# Slack / Notion 投稿の詳細

## Slack

### 投稿フォーマット

分析結果を **1 回の投稿で** まとめて送る。

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
{externalGoals.linkedGoals を1行ずつ。例: 「・MCP基盤のリモート化（individual） — 関連: #587 #593」}
{未設定/紐づけ不可なら「（外部目標未設定）」と1行で表示}

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

### 投稿コマンド

```bash
curl -X POST https://slack.com/api/chat.postMessage \
  -H "Authorization: Bearer ${SLACK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"channel": "${SLACK_CHANNEL}", "text": "..."}'
```

### ポイント

- PR 一覧は必ずリンク付き
- インサイト直後に区切り線（`---`）を入れ、目標との関連・次アクションを続ける
- アサインされた Issue/PR は「今やるべきこと」として最優先で出す
- 上限は約 40,000 文字。超えそうなら要約版を投稿し、詳細は JSON 参照と案内

---

## Notion

新規ページを作って既存ページの削除を案内する方式で行う（ページ更新ではなく作成）。

### 1. データベース情報の取得

`.env` の `NOTION_DATABASE_URL` を使用してデータベース構造を取得：

```
mcp__notion__notion-fetch を使用:
- id: ${NOTION_DATABASE_URL}
```

レスポンスから `data_source_id` を抽出（`collection://` 形式の URL）。

### 2. 既存ページの確認

同じ期間のレポートが既に存在するか確認：

```
mcp__notion__notion-search を使用:
- query: "PR分析レポート: {SINCE_DATE}"
```

既存ページが見つかった場合は、その URL を記録しておく（後で旧ページの削除を案内するため）。

### 3. ページの新規作成

`mcp__notion__notion-create-pages` を使用してレポートを作成：

```json
{
  "parent": {
    "data_source_id": "{取得したdata_source_id}"
  },
  "pages": [
    {
      "properties": {
        "Name": "PR分析レポート: {SINCE_DATE} 〜 {TODAY}",
        "date:Date:start": "{SINCE_DATE}",
        "date:Date:end": "{TODAY}",
        "date:Date:is_datetime": 0
      },
      "content": "{Markdownファイルの内容}"
    }
  ]
}
```

### 4. 旧ページの削除案内

既存ページが見つかっていた場合、ユーザーに旧ページの手動削除を案内：

```
新しいレポートを作成しました: {新ページURL}
旧ページは手動で削除してください: {旧ページURL}
```

### 5. Notion Markdown 形式のポイント

- 標準 Markdown（table、`- [ ]`、`##`、`>`、`---`）はそのまま使える
- **PR 番号のリンク**: レポート内のすべての PR 番号（例: `#595`）は、対応する GitHub PR への Markdown リンク形式（例: `[#595](https://github.com/{owner}/{repo}/pull/595)`）で記述する。「🎯 目標との関連」「PR 間の関係性」「継続・フォローアップ」セクションも含め、PR 番号が登場するすべての箇所にリンクを付与すること
- Notion はページタイトルを自動で表示するため、content の先頭に `# タイトル` は不要
