const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const timezone = require('dayjs/plugin/timezone')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.extend(customParseFormat)

const TZ = 'Europe/Istanbul'
const SITE = 'https://www.tivibu.com.tr'
const API = `${SITE}/Channel/GetMultiPrevueData`
const TOKEN_NAME = 'CSRF-TOKEN-TVBUDNBX!-FORM'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
const MAX_PAGES = 20 // 159 channels / 14 per page = 12 pages today

// The API needs the anti-forgery token from /canli-tv plus the cookies set with it.
// One handshake per run, shared by every request.
let sessionPromise
function getSession() {
  if (!sessionPromise) {
    sessionPromise = axios
      .get(`${SITE}/canli-tv`, { headers: { 'User-Agent': USER_AGENT } })
      .then(res => {
        const html = String(res.data)
        const m = html.match(/name="CSRF-TOKEN-TVBUDNBX!-FORM"[^>]*value="([^"]+)"/) ||
          html.match(/value="([^"]+)"[^>]*name="CSRF-TOKEN-TVBUDNBX!-FORM"/)
        if (!m) throw new Error('tivibu.com.tr: no CSRF token on /canli-tv (WAF block?)')
        const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ')
        return { token: m[1], cookie }
      })
      .catch(err => {
        sessionPromise = undefined // allow a retry on the next request
        throw err
      })
  }
  return sessionPromise
}

function buildHeaders({ token, cookie }) {
  return {
    'User-Agent': USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
    Requestverificationtoken: token,
    Referer: `${SITE}/canli-tv`,
    Cookie: cookie
  }
}

function buildForm({ date, search = '', page = 1, token }) {
  // dates are Istanbul calendar days
  const day = dayjs.utc(date).format('YYYY.MM.DD')
  return new URLSearchParams({
    channelColumnCode: '020000',
    channelDateBegin: `${day} 00:00:00`,
    channelDateEnd: `${day} 23:59:59`,
    channelSearchValue: search,
    pageNo: String(page),
    [TOKEN_NAME]: token
  }).toString()
}

// "1258" or "ch00000000000000001258" -> "1258"
function codeOf(value) {
  return String(value || '').replace(/\D/g, '').replace(/^0+/, '')
}

function parseContent(content) {
  try {
    const data = typeof content === 'string' || Buffer.isBuffer(content) ? JSON.parse(content) : content
    return data && typeof data === 'object' ? data : null
  } catch {
    return null
  }
}

// Fallback when the channel name in channels.xml doesn't match the site's name:
// fetch every page for the day once and keep it in memory.
const dayCache = new Map()
function getAllItems(date) {
  const key = dayjs.utc(date).format('YYYY-MM-DD')
  if (!dayCache.has(key)) {
    const promise = (async () => {
      const session = await getSession()
      const items = []
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await axios.post(API, buildForm({ date, page, token: session.token }), {
          headers: buildHeaders(session)
        })
        const list = res.data?.prevueListViewModel || []
        if (!list.length) break
        items.push(...list)
      }
      return items
    })().catch(err => {
      dayCache.delete(key)
      throw err
    })
    dayCache.set(key, promise)
  }
  return dayCache.get(key)
}

function toPrograms(items, date) {
  const day = dayjs.utc(date).format('YYYY-MM-DD')
  const programs = []
  let prevStart = null

  items.forEach((item, index) => {
    if (!item.prevueName || !item.exactBeginTime || !item.exactEndTime) return
    // The first entry is often the previous day's programme that runs past
    // midnight (e.g. 23:45-01:45). It belongs to yesterday's guide, so skip it.
    if (index === 0 && item.exactBeginTime !== '00:00' && item.exactEndTime < item.exactBeginTime) {
      return
    }

    let start = dayjs.tz(`${day} ${item.exactBeginTime}`, 'YYYY-MM-DD HH:mm', TZ)
    if (prevStart && !start.isAfter(prevStart)) start = start.add(1, 'd')
    let stop = dayjs.tz(`${start.format('YYYY-MM-DD')} ${item.exactEndTime}`, 'YYYY-MM-DD HH:mm', TZ)
    if (!stop.isAfter(start)) stop = stop.add(1, 'd')
    prevStart = start

    programs.push({
      title: item.prevueName,
      description: item.description || null,
      category: item.genre || null,
      image: item.prevueImage || null,
      start,
      stop
    })
  })

  return programs
}

module.exports = {
  site: 'tivibu.com.tr',
  days: 3,
  url: API,
  request: {
    method: 'POST',
    async headers() {
      return buildHeaders(await getSession())
    },
    async data({ date, channel }) {
      const { token } = await getSession()
      // searching by the site's own channel name returns just that channel (one request)
      return buildForm({ date, search: channel.name || '', token })
    }
  },
  async parser({ content, channel, date }) {
    const code = codeOf(channel.site_id)
    const data = parseContent(content)
    let items = (data?.prevueListViewModel || []).filter(i => codeOf(i.channelCode) === code)

    if (!items.length) {
      const all = await getAllItems(date).catch(() => [])
      items = all.filter(i => codeOf(i.channelCode) === code)
    }

    return toPrograms(items, date)
  },
  async channels() {
    const session = await getSession()
    const date = dayjs().tz(TZ).format('YYYY-MM-DD')
    const channels = []
    const seen = new Set()

    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await axios.post(API, buildForm({ date, page, token: session.token }), {
        headers: buildHeaders(session)
      })
      const list = res.data?.channelListViewModel || []
      if (!list.length || !(res.data?.prevueListViewModel || []).length) break
      list.forEach(c => {
        const site_id = codeOf(c.channelCode)
        if (!site_id || seen.has(site_id)) return
        seen.add(site_id)
        channels.push({ lang: 'tr', site_id, name: c.channelName, logo: c.channelImage || undefined })
      })
    }

    return channels
  }
}
