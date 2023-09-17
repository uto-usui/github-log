import 'dotenv/config'
import fs from 'fs'
import path from 'path'

// Token for authentication. Replace with your token.
const token = process.env.GITHUB_TOKEN
const userName = process.env.GITHUB_USER_NAME

// Get current date as millisecond
const nowMs = Date.now()

// JST is ahead of UTC by 9 hours
const offsetMs = 9 * 60 * 60 * 1000

// Get today's date in JST
const today = new Date(nowMs + offsetMs)

// Get the date one week ago in JST
const since = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

// Get YYYY-MM-DD format
const formatDate = (date: Date): string => date.toISOString().split('T')[0]
const sinceFormatted = formatDate(since)
const todayFormatted = formatDate(today)

fetch(
  `https://api.github.com/search/issues?q=author:${userName}+merged:${sinceFormatted}..${todayFormatted}`,
  {
    method: 'GET',
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json'
    }
  }
)
  .then((response) => response.json())
  .then((data) => {
    const items = data.items.map((item: any) => ({
      title: item.title,
      closed_at: item.closed_at,
      url: item.url,
      body: item.body
    }))

    const dir = 'out'
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir)
    }

    const filePath = path.join(dir, `mergedPRs_${sinceFormatted}_to_${todayFormatted}.json`)

    fs.writeFile(filePath, JSON.stringify(items, null, 2), 'utf8', (error) => {
      if (error) {
        console.error(error)
        return
      }
      console.log('File has been created')
    })
  })
  .catch((error) => console.error(error))
