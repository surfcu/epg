const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(customParseFormat)

// Public keys shipped with the D-Smart GO web client (see /client/site-config)
const EPG_API = 'https://global-epg-prod.erstream.com'
const EPG_KEY = 'pln1jFxpWu1AMwtH1PIU'
const CMS_API = 'https://iwxa44sbbqmf.merlincdn.net'
const CMS_KEY = 'a8fbff0087d146ddbfa26a13ebbf83c6'
const LIVE_CHANNEL_CONTENT_TYPE = 27819

module.exports = {
  site: 'dsmartgo.com.tr',
  days: 3,
  request: {
    cache: {
      ttl: 60 * 60 * 1000 // 1 hour
    }
  },
  url({ channel, date }) {
    // timezone=00 makes date/startHour UTC; endDate is exclusive
    return `${EPG_API}/Epg/GetChannelEpgWithRange?includeEnding=false&fillResponse=false&key=${
      EPG_KEY
    }&cmsId=${channel.site_id}&startDate=${date.format('YYYY-MM-DD')}&endDate=${date
      .add(1, 'd')
      .format('YYYY-MM-DD')}&timezone=00&lang=tr`
  },
  parser({ content, date }) {
    const programs = []
    const items = parseItems(content)
    const day = date.format('YYYY-MM-DD')

    items.forEach(item => {
      // statusCode 300 = placeholder generated to fill gaps
      if (item.statusCode && item.statusCode !== 200) return
      if (!item.name || !item.date || !item.startHour) return
      // the API also returns the programme running at midnight from the previous day
      if (item.date.substring(0, 10) !== day) return

      const start = dayjs.utc(`${item.date.substring(0, 10)} ${item.startHour}`, 'YYYY-MM-DD HH:mm:ss')
      let stop
      if (item.duration) {
        stop = start.add(item.duration, 'm')
      } else {
        stop = dayjs.utc(`${item.date.substring(0, 10)} ${item.endHour}`, 'YYYY-MM-DD HH:mm:ss')
        if (!stop.isAfter(start)) stop = stop.add(1, 'd')
      }

      programs.push({
        title: item.name,
        description: item.description && item.description !== item.name ? item.description : null,
        start,
        stop
      })
    })

    return programs
  },
  async channels() {
    const channels = []
    const displayCount = 100
    let pageNumber = 1
    let total = Infinity

    while ((pageNumber - 1) * displayCount < total) {
      const res = await axios
        .post(
          `${CMS_API}/v1/item/filter/?mcdn-langauge-code=tr&platform=web`,
          {
            displayCount,
            pageNumber,
            contentTypeIds: [LIVE_CHANNEL_CONTENT_TYPE],
            customFilters: [],
            sort: { field: 'CustomFieldOrder', order: 'asc', namespace: 'Order' },
            include: ['customField']
          },
          {
            headers: {
              'Content-Type': 'application/json',
              apiKey: CMS_KEY,
              langCode: 'tr'
            }
          }
        )
        .then(r => r.data)
        .catch(console.error)

      if (!res || !Array.isArray(res.data)) break
      total = res.totalCount || 0

      res.data
        .filter(item => (item.customFields || []).some(f => f.field === 'EpgSource'))
        .forEach(item => {
          channels.push({
            lang: 'tr',
            site_id: String(item.id),
            name: item.displayTitle || item.name
          })
        })

      if (res.data.length < displayCount) break
      pageNumber++
    }

    return channels
  }
}

function parseItems(content) {
  try {
    const data = typeof content === 'string' ? JSON.parse(content) : content
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
