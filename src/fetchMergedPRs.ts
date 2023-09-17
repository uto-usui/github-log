import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { WebClient } from '@slack/web-api'

const web = new WebClient(process.env.SLACK_TOKEN)
const dir = 'out'
const token = process.env.GITHUB_TOKEN
const userName = process.env.GITHUB_USER_NAME
const channel = process.env.SLACK_CHANNEL ?? ''
const offsetMs = 9 * 60 * 60 * 1000

const getDateString = (days: number) => {
  const date = new Date(Date.now() + offsetMs - days * 24 * 60 * 60 * 1000)
  return date.toISOString().split('T')[0]
}

const sendMessageToSlack = async (message: string) => {
  const res = await web.chat.postMessage({ channel, text: message })
  console.log('send message 🚀', res.ts)
}

const fetchPRsAndWriteToFile = async () => {
  const sinceFormatted = getDateString(7)
  const todayFormatted = getDateString(0)

  const response = await fetch(
    `https://api.github.com/search/issues?q=author:${userName}+merged:${sinceFormatted}..${todayFormatted}`,
    {
      method: 'GET',
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    }
  )

  const data = await response.json()

  const items = data.items.map((item: any) => ({
    title: item.title,
    closed_at: item.closed_at,
    url: item.url,
    body: item.body
  }))

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir)
  }

  const filePath = path.join(dir, `mergedPRs_${sinceFormatted}_to_${todayFormatted}.json`)
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2), 'utf8')

  console.log('created file 🔥')

  const formattedMessage = items
    .map(
      (item: any, index: number) =>
        `* 🔖 ${index + 1}. ${item.title}*\n ✔️ ${item.closed_at}\n 🔗 ${item.url}\n 📝 ${
          item.body ?? '🐈'
        }\n\n`
    )
    .join('\n')

  sendMessageToSlack(formattedMessage).catch((error) => console.error(error))
}

fetchPRsAndWriteToFile().catch((error) => console.error('error：', error))
