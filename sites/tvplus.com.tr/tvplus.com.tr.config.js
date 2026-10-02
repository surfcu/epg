const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')

dayjs.extend(utc)
dayjs.extend(timezone)

const TZ = 'Europe/Istanbul'
const SITE = 'https://tvplus.com.tr'
const FALLBACK_HOST = 'https://gbzottvsc17.tvplus.com.tr:33207'

// The EPG host is assigned per session by the site; nodes rotate (sc01, sc13, sc17, ...).
let hostPromise
function getHost() {
  if (!hostPromise) {
    hostPromise = axios
      .post(`${SITE}/get-platform-info`, { platform: 'production' })
      .then(r => String(r.data?.https || FALLBACK_HOST).replace(/\/+$/, ''))
      .catch(() => FALLBACK_HOST)
  }
  return hostPromise
}

// One anonymous (guest) session for the whole run instead of one login per request.
let sessionPromise
function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const host = await getHost()
      const res = await axios.post(`${host}/EPG/JSON/Authenticate`, {
        terminaltype: 'webtv', // must be lowercase; "WEBTV" fails with "deviceModel does not exist"
        terminalvendor:
          '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.0.0 Safari/537.36',
        osversion: 'Win32',
        userType: '3',
        utcEnable: '1',
        timezone: TZ
      })
      if (res.data?.retcode !== '0') {
        throw new Error(`tvplus.com.tr: guest auth failed (${res.data?.retcode} ${res.data?.retmsg})`)
      }
      const cookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0])
      if (!cookies.some(c => c.startsWith('JSESSIONID=')) && res.data.jSessionID) {
        cookies.push(`JSESSIONID=${res.data.jSessionID}`)
      }
      return cookies.join('; ')
    })().catch(err => {
      sessionPromise = undefined // allow a retry on the next request
      throw err
    })
  }
  return sessionPromise
}

// API returns e.g. "2026-10-03 00:45:00 UTC+03:00"
function parseTime(str) {
  if (!str) return null
  const m = str.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC([+-]\d{2}:\d{2})$/)
  return m ? dayjs(`${m[1]}T${m[2]}${m[3]}`) : dayjs.tz(str, TZ)
}

function toInt(v) {
  const n = parseInt(v, 10)
  return n > 0 ? n : null
}

function pickImage(item) {
  const list = (item.picture?.ad || item.picture?.still || '').split(',').filter(Boolean)
  return list.find(u => u.includes('_0_XL.')) || list[0] || null
}

module.exports = {
  site: 'tvplus.com.tr',
  days: 2,
  url: async () => `${await getHost()}/EPG/JSON/PlayBillList`,
  request: {
    method: 'POST',
    async headers() {
      return {
        'Content-Type': 'application/json',
        Cookie: await getSession(),
        Origin: SITE,
        Referer: `${SITE}/`
      }
    },
    data({ date, channel }) {
      // site_id is "slug/id" (or a bare id); the API wants the numeric id.
      const channelid = String(channel.site_id).split(/--|\//).pop()
      // begintime/endtime are read as UTC; ask for the Istanbul calendar day.
      const start = dayjs.tz(dayjs.utc(date).format('YYYY-MM-DD'), TZ).utc()
      return {
        type: '2',
        channelid,
        // NOT "starttime": that key is ignored and the API returns everything from "now"
        begintime: start.format('YYYYMMDDHHmmss'),
        endtime: start.add(1, 'd').format('YYYYMMDDHHmmss'),
        isFillProgram: 0
      }
    }
  },
  parser({ content }) {
    let data
    try {
      data = typeof content === 'string' || Buffer.isBuffer(content) ? JSON.parse(content) : content
    } catch {
      return []
    }
    if (!data || !Array.isArray(data.playbilllist)) return []

    return data.playbilllist
      .filter(item => item.name && item.gapFiller !== '1')
      .map(item => ({ item, image: pickImage(item) }))
      .map(({ item, image }) => ({
        title: item.name,
        description: item.introduce || null,
        category: item.genres ? item.genres.split(',').map(g => g.trim()).filter(Boolean) : [],
        image,
        icon: image, // <icon> for Tvheadend and older XMLTV readers
        season: toInt(item.seasonNum),
        episode: toInt(item.subNum),
        start: parseTime(item.starttime),
        stop: parseTime(item.endtime)
      }))
  },
  async channels() {
    const cheerio = require('cheerio')
    const { data } = await axios.get(`${SITE}/canli-tv/yayin-akisi`)
    const $ = cheerio.load(data)
    const seen = new Set()
    const channels = []
    $('a[href*="/canli-tv/yayin-akisi/"]').each((_, el) => {
      const m = ($(el).attr('href') || '').match(/\/canli-tv\/yayin-akisi\/([a-z0-9-]+)--(\d+)$/)
      if (!m || seen.has(m[2])) return
      seen.add(m[2])
      const name =
        $(el).text().trim() || ($(el).attr('title') || '').replace(/\s*Yayın Akışı$/, '').trim()
      // same "slug/id" shape as tvplus.com.tr.channels.xml
      channels.push({ lang: 'tr', name, site_id: `${m[1]}/${m[2]}` })
    })
    return channels
  }
}
