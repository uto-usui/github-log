# github-log

The code performs the following actions:

1. Loads environment variables from the .env file.
2. Creates a WebClient instance to communicate with the Slack client.
3. Uses the username to search for pull requests merged during a certain period.
4. Writes the search results to a JSON file and saves the results in the out directory.
5. Sends a message to Slack with the title, merge time, URL, and body of each pull request.

Please note that if the 'out' directory does not exist, it will be created automatically.

1. Create a file named .env in your project's root directory. 
2. Add the following lines to the .env file:

```bash
# Required
SLACK_TOKEN=<your Slack token>
GITHUB_TOKEN=<your GitHub token>
GITHUB_USER_NAME=<your GitHub username>
GITHUB_ORG=<GitHub Organization to scope the analysis (excludes personal repos)>
SLACK_CHANNEL=<the Slack channel to send messages to>

# Optional
NOTION_DATABASE_URL=<Notion database URL for work logs>
GOALS_REPO=<owner/repo where personal or team goals are stored (e.g. note-jp/team-goals)>
GOALS_PATHS=<comma-separated paths to goal markdown files (e.g. individual/usui.md,team/q1-2026.md)>
```

Replace each environment variable with the actual values.

`GITHUB_ORG` is consumed only by the `/analyze-prs` slash command to restrict the PR search to a single Organization. The Node CLI (`pnpm start`) still uses `GITHUB_USER_NAME` as before.
