# 出力フォーマット仕様

## JSON 構造

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
      "summary": "LLM による要約",
      "commits": 5,
      "filesChanged": [...],
      "relatedPRs": [122, 124]
    }
  ],
  "inProgressPRs": [
    {
      "number": 10898,
      "title": "...",
      "url": "...",
      "repository": "owner/repo",
      "createdAt": "YYYY-MM-DD",
      "commitsInPeriod": 35,
      "commitsTotal": 35,
      "filesChanged": 89,
      "additions": 2724,
      "deletions": 1016,
      "reviewState": "approved / AI レビューのみ / レビュー未了 のいずれかを具体的に",
      "summary": "マージ済み PR と同じ粒度の要約",
      "goalRelevance": "どの目標にどう効くか",
      "openItems": ["未チェックの Test plan 項目", "approve 待ち など"]
    }
  ],
  "inProgressSummary": {
    "count": 4,
    "commitsInPeriod": 47,
    "criterion": "open かつ期間内にコミットがある PR（--author=@me --state=open --updated=<period>）",
    "note": "期間内に一度も更新のない open PR は実績に数えず nextActions.assignedPRs（長期滞留）へ回す",
    "largest": "#10898（89 files +2724/-1016）",
    "mergeable": [10917, 10774]
  },
  "insights": "LLM によるインサイト",
  "context": {
    "externalGoals": {
      "source": {
        "repo": "uto-usui/obsidian",
        "paths": [
          "database/memos/goal-setting/2026H2 個人目標.md",
          "database/memos/goal-setting/2026H2チーム目標.md"
        ]
      },
      "linkedGoals": [
        {
          "title": "ハーネスエンジニアリングの体系化と組織標準化",
          "scope": "individual",
          "whySummary": "H1で立ち上げた単発のガードを体系として束ね、組織標準にする",
          "relatedPRs": [587, 593]
        },
        {
          "title": "AI 民主化を支えるアセット供給",
          "scope": "individual",
          "whySummary": "LP / スライド / バナー等の領域にデザインシステムを拡張",
          "relatedPRs": [610]
        }
      ]
    },
    "prRelationships": [
      {
        "parent": 587,
        "child": 593,
        "relationship": "#587で基盤構築 → #593でセッション管理追加"
      }
    ],
    "background": "なぜこの期間にこれらの作業を行ったかの背景（社内公開を前提に、私的な事情は書かない）"
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

## Markdown テンプレート

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
| 総PR数（マージ済み） | {totalPRs} |
| feat | {feat数} |
| fix | {fix数} |
| refactor | {refactor数} |
| docs | {docs数} |
| other | {other数} |
| **作業中（未マージ・期間内コミットあり）** | **{inProgressSummary.count}**（期間内コミット計 {inProgressSummary.commitsInPeriod}） |

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

## 🚧 作業中（未マージ・期間内にコミットあり）

merge には至っていないが、期間内に実際に手を動かした PR。**次のアクションではなくその週の作業実績**として扱う。期間内コミット合計 {inProgressSummary.commitsInPeriod}。

| PR | 期間内コミット | 変更規模 | レビュー状態 |
|---|---|---|---|
| #{number} | {commitsInPeriod}（全 {commitsTotal} 中） | {filesChanged} files `+{additions}/-{deletions}` | {reviewState} |

### [#{number}] {タイトル}

- **期間内の作業**: {日付範囲} に {commitsInPeriod} コミット
- **規模**: {filesChanged} ファイル `+{additions}/-{deletions}`
- **内容**: {マージ済み PR と同じ粒度の要約}
- **目標との関係**: {goalRelevance}
- **状態**: {reviewState}。{openItems}
- **URL**: {url}

> approved 済みで放置されているものは「**マージ可能**」と明示する。

---

## ⭐ 主なハイライト

{この期間の特筆すべき成果。未マージでも規模が大きい作業中 PR は載せる}

## 🔧 技術トピック

{使用された技術・ツール・パターンの傾向}

## 💡 インサイト

{LLMによる分析コメント}

---

## 🎯 目標との関連

> 出典: `{GOALS_REPO}` の `{GOALS_PATHS}` を参照（未設定なら本節は省略）

### 紐づいた目標
{externalGoals.linkedGoals を以下の形式で記載}

- **{title}**（{scope}）
  - 狙い: {whySummary}
  - 関連PR: #{PR番号} / #{PR番号} / 🚧 #{作業中PR番号}（未マージ）...

> 作業中 PR を紐づけるときは `🚧` を付けて未マージだと分かるようにする（`relatedInProgressPRs`）。

> 原文の「狙い（Why）」「Actions」「評価基準」本文は転載しない。タイトル + 1〜2行サマリ + 関連PRのみに留める。

### PR間の関係性
{prRelationships を説明形式で}

### 背景
{background — 社内公開前提のため、私的な事情は書かない}

## ➡️ 次のアクション

### アサインされたIssue
{assignedIssues をチェックリスト形式で}

### アサインされたPR（長期滞留・期間内の更新なし）
{assignedPRs をチェックリスト形式で。期間内にコミットのある PR は「🚧 作業中」へ移してあるのでここには出さない。全 N 件のうち何件かを明記する}

### レビュー待ち
{reviewRequested をチェックリスト形式で}

### 継続・フォローアップ
{extractedFromPRs + userInput をチェックリスト形式で}

### [提案] Issue作成を推奨
{suggestIssue: true のものをリスト形式で}
```
