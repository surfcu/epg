const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = 'Europe/Istanbul'
const API = 'https://www.digiturkplay.com/api/service/tvguides'
const API_PATH = '/api/v1/broadcast/tvguides'
const PLACEHOLDER_GENRE = /^[A-Z]\d*$/ // internal codes such as "F2"

// The API reads startTime/endTime as Istanbul wall-clock time even though they end in "Z",
// so send the local day's 00:00-23:59 with a Z suffix (this is what the website does too).
function buildBody(date, slugs) {
  const day = dayjs.utc(date).format('YYYY-MM-DD')
  const body = { startTime: `${day}T00:00:00.000Z`, endTime: `${day}T23:59:59.999Z` }
  if (slugs) body.channelSlugs = slugs
  return JSON.stringify({ path: API_PATH, body })
}

function parseItems(content) {
  try {
    const data = typeof content === 'string' || Buffer.isBuffer(content) ? JSON.parse(content) : content
    return Array.isArray(data?.data?.items) ? data.data.items : []
  } catch {
    return []
  }
}

// "Gece Lezzetleri S1 B5" -> "Gece Lezzetleri" when season/episode are given separately
function cleanTitle(item) {
  const title = (item.title || '').trim()
  const series = (item.seriesName || '').trim()
  if (series && (item.seasonNo || item.episodeNo) && title.startsWith(series)) return series
  return title
}

module.exports = {
  site: 'digiturkplay.com',
  days: 7,
  url: API,
  request: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.digiturkplay.com',
      Referer: 'https://www.digiturkplay.com/tr/yayin-akisi'
    },
    data({ channel, date }) {
      return buildBody(date, [channel.site_id])
    }
  },
  parser({ content, channel, date }) {
    const entry = parseItems(content).find(i => i?.channel?.slug === channel.site_id)
    if (!entry || !Array.isArray(entry.epgList)) return []

    const dayStart = dayjs.tz(dayjs.utc(date).format('YYYY-MM-DD'), TZ)
    const dayEnd = dayStart.add(1, 'd')

    return entry.epgList
      .map(item => ({ item, start: dayjs.utc(item.startTime), stop: dayjs.utc(item.endTime) }))
      .filter(({ item, start, stop }) => item.title && start.isValid() && stop.isValid())
      // the first entry is usually the previous day's last programme; it belongs to that day
      .filter(({ start }) => !start.isBefore(dayStart) && start.isBefore(dayEnd))
      .map(({ item, start, stop }) => {
        const title = cleanTitle(item)
        const subtitle = (item.subtitle || '').trim()
        const genres = (item.genreList?.length ? item.genreList : [item.genre]).filter(
          g => g && !PLACEHOLDER_GENRE.test(g)
        )
        return {
          title,
          description: subtitle && subtitle !== item.title.trim() && subtitle !== title ? subtitle : null,
          category: genres,
          season: item.seasonNo || null,
          episode: item.episodeNo || null,
          start,
          stop
        }
      })
  },
  async channels() {
    const today = dayjs.utc(dayjs().tz(TZ).format('YYYY-MM-DD'))
    const { data } = await axios.post(API, buildBody(today), {
      headers: { 'Content-Type': 'application/json' }
    })
    return parseItems(data)
      .map(i => i.channel)
      .filter(c => c && c.slug && c.genre !== 'Radyo' && !/^test/i.test(c.name))
      .map(c => ({ lang: 'tr', site_id: c.slug, name: c.name }))
  }
}
