const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const TZ = 'Europe/Istanbul'
const BASE = 'https://www.turksatkablo.com.tr/userUpload/EPG'

// One file per day of the month: 1.json ... 31.json (no leading zero).
// Only yesterday/today/tomorrow are kept current; the rest still hold last month.
function fileUrl(day) {
  return `${BASE}/${day}.json`
}

function parseJson(content) {
  try {
    const text = Buffer.isBuffer(content) ? content.toString() : String(content || '')
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

// The file has no date in it, so use Last-Modified to reject a file left over from last month.
// Current files are published about a day ahead.
function isStale(headers, date) {
  const lastModified = headers?.['last-modified']
  if (!lastModified) return false
  const modified = dayjs(lastModified)
  if (!modified.isValid()) return false
  const day = dayjs.utc(date).startOf('d')
  return modified.isBefore(day.subtract(4, 'd')) || modified.isAfter(day.add(2, 'd'))
}

module.exports = {
  site: 'turksatkablo.com.tr',
  days: 2,
  url({ date }) {
    return fileUrl(dayjs.utc(date).date())
  },
  request: {
    timeout: 60000,
    cache: {
      ttl: 60 * 60 * 1000 // 1 hour; one file serves every channel
    }
  },
  parser({ content, headers, channel, date }) {
    if (isStale(headers, date)) return []
    const data = parseJson(content)
    if (!data || !Array.isArray(data.k)) return []

    const entry = data.k.find(c => String(c.i) === String(channel.site_id))
    if (!entry || !Array.isArray(entry.p)) return []

    const day = dayjs.utc(date).format('YYYY-MM-DD')
    const programs = []
    let prevStart = null

    entry.p.forEach(item => {
      // a="0" / b="-" marks the part of yesterday's last programme after midnight
      if (!item.b || item.b.trim() === '-' || String(item.a) === '0') return
      if (!item.c || !item.d) return

      let start = dayjs.tz(`${day} ${item.c}`, 'YYYY-MM-DD HH:mm', TZ)
      if (prevStart && start.isBefore(prevStart)) start = start.add(1, 'd')
      let stop = dayjs.tz(`${start.format('YYYY-MM-DD')} ${item.d}`, 'YYYY-MM-DD HH:mm', TZ)
      if (!stop.isAfter(start)) stop = stop.add(1, 'd')
      prevStart = start

      programs.push({ title: item.b.trim(), start, stop })
    })

    return programs
  },
  async channels() {
    const day = dayjs().tz(TZ).date()
    const { data } = await axios.get(fileUrl(day), { responseType: 'text' })
    const parsed = parseJson(data)
    const list = parsed?.k || []

    const schedules = new Set()
    const channels = []
    list.forEach(c => {
      // 900+ are copies of main channels with identical schedules; keep the first one
      const key = `${c.n}|${JSON.stringify(c.p)}`
      if (schedules.has(key)) return
      schedules.add(key)
      channels.push({ lang: 'tr', site_id: String(c.i), name: c.n })
    })

    return channels
  }
}
