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
const TOKEN_NAME = 'CSRF-TOKEN-TVBUDNBX!-FORM'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
const MAX_PAGES = 20 // channel list: 159 channels / 14 per page

// RTÜK age ratings
const RATINGS = {
  generalAudience: 'Genel İzleyici',
  plus7: '7+',
  plus13: '13+',
  plus18: '18+'
}

// The API needs the anti-forgery token from /canli-tv plus the cookies set with it.
// One handshake per run, shared by every request.
let sessionPromise
function getSession() {
  if (!sessionPromise) {
    sessionPromise = axios
      .get(`${SITE}/canli-tv`, { headers: { 'User-Agent': USER_AGENT } })
      .then(res => {
        const html = String(res.data)
        const m =
          html.match(/name="CSRF-TOKEN-TVBUDNBX!-FORM"[^>]*value="([^"]+)"/) ||
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

// "1258" or "ch00000000000000001258" -> "1258"
function codeOf(value) {
  return String(value || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '')
}

function parseTime(str) {
  return str ? dayjs.tz(str, 'YYYY.MM.DD HH:mm:ss', TZ) : null
}

module.exports = {
  site: 'tivibu.com.tr',
  days: 5,
  url: `${SITE}/Channel/GetPrevueList`,
  request: {
    method: 'POST',
    async headers() {
      return buildHeaders(await getSession())
    },
    data({ date, channel }) {
      // dates are Istanbul calendar days
      const day = dayjs.utc(date).format('YYYY.MM.DD')
      return new URLSearchParams({
        channelCode: `ch${codeOf(channel.site_id).padStart(20, '0')}`,
        channelDateBegin: `${day} 00:00:00`,
        channelDateEnd: `${day} 23:59:59`
      }).toString()
    }
  },
  parser({ content, date }) {
    let data
    try {
      data = typeof content === 'string' || Buffer.isBuffer(content) ? JSON.parse(content) : content
    } catch {
      return []
    }
    const items = data?.mobilPrevueViewModel
    if (!Array.isArray(items)) return []

    const dayStart = dayjs.tz(dayjs.utc(date).format('YYYY-MM-DD'), TZ)
    const dayEnd = dayStart.add(1, 'd')

    return items
      .map(item => ({ item, start: parseTime(item.beginTime), stop: parseTime(item.endTime) }))
      .filter(({ item, start, stop }) => item.prevueName && start?.isValid() && stop?.isValid())
      // the first entry is usually yesterday's late programme running past midnight;
      // it is already the last entry of the previous day's response
      .filter(({ start }) => !start.isBefore(dayStart) && start.isBefore(dayEnd))
      .map(({ item, start, stop }) => ({
        title: item.prevueName,
        description: item.description || null,
        category: item.genre || null,
        image: item.prevueImage || null,
        rating: RATINGS[item.ratingId] ? { system: 'RTÜK', value: RATINGS[item.ratingId] } : null,
        start,
        stop
      }))
  },
  async channels() {
    const session = await getSession()
    const day = dayjs().tz(TZ).format('YYYY.MM.DD')
    const channels = []
    const seen = new Set()

    for (let page = 1; page <= MAX_PAGES; page++) {
      const form = new URLSearchParams({
        channelColumnCode: '020000',
        channelDateBegin: `${day} 00:00:00`,
        channelDateEnd: `${day} 23:59:59`,
        channelSearchValue: '',
        pageNo: String(page),
        [TOKEN_NAME]: session.token
      }).toString()
      const res = await axios.post(`${SITE}/Channel/GetMultiPrevueData`, form, {
        headers: buildHeaders(session)
      })
      const list = res.data?.channelListViewModel || []
      if (!list.length || !(res.data?.prevueListViewModel || []).length) break
      list.forEach(c => {
        const site_id = codeOf(c.channelCode)
        if (!site_id || seen.has(site_id)) return
        seen.add(site_id)
        channels.push({ lang: 'tr', site_id, name: c.channelName })
      })
    }

    return channels
  }
}
