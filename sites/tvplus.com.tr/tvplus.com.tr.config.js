const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')

dayjs.extend(utc)
dayjs.extend(customParseFormat)

module.exports = {
  site: 'tvplus.com.tr',
  days: 2,
  // Use the specific API endpoint you observed
  url: 'https://gbzottvsc27.tvplus.com.tr:33207/EPG/JSON/PlayBillList',
  
  request: {
    method: 'POST',
    async headers() {
      // Step 1: Fresh Authentication for every run to get a valid session
      const auth = await axios.post('https://gbzottvsc27.tvplus.com.tr:33207/EPG/JSON/Authenticate', {
        terminaltype: 'webtv',
        terminalvendor: 'chrome',
        osversion: 'Windows',
        userType: '3',
        utcEnable: '1',
        timezone: 'UTC'
      }).catch(() => null)

      const cookies = auth && auth.headers['set-cookie'] 
        ? auth.headers['set-cookie'].join('; ') 
        : ''

      return {
        'Content-Type': 'application/json',
        'Cookie': cookies,
        'Origin': 'https://tvplus.com.tr',
        'Referer': 'https://tvplus.com.tr/'
      }
    },
    data({ date, channel }) {
      // Step 2: Clean the ID. The POST API only accepts the numeric ID (e.g. 130)
      const numericId = channel.site_id.split(/--|\//).pop()

      // Step 3: Precisely match the payload format you saw in logs
      return {
        type: '2',
        channelid: numericId,
        // The API expects UTC-based timestamps for the window
        starttime: date.startOf('day').format('YYYYMMDDHHmmss'),
        endtime: date.endOf('day').format('YYYYMMDDHHmmss'),
        isFillProgram: 1
      }
    }
  },

  parser: function ({ content }) {
    const programs = []
    if (!content) return programs

    let data
    try {
      data = typeof content === 'string' ? JSON.parse(content) : content
    } catch (e) {
      return programs
    }

    const items = data.playbilllist || []

    items.forEach(item => {
      // API returns time in 'YYYYMMDDHHmmss' format
      programs.push({
        title: item.name,
        category: item.genres ? [item.genres] : [],
        description: item.introduce,
        icon: item.picurl || (item.pictures && item.pictures[0]?.href) || null,
        start: dayjs.utc(item.starttime, 'YYYYMMDDHHmmss').toJSON(),
        stop: dayjs.utc(item.endtime, 'YYYYMMDDHHmmss').toJSON()
      })
    })

    return programs
  },

  async channels() {
    const cheerio = require('cheerio')
    const channels = []
    
    // Scrape the main page to find channel names and their numeric IDs
    const response = await axios.get(`https://tvplus.com.tr/canli-tv/yayin-akisi`).catch(() => null)
    if (!response) return []

    const $ = cheerio.load(response.data)
    $('.channelListItem').each((i, el) => {
      const name = $(el).find('.channelName').text().trim()
      const url = $(el).find('.channelLink').attr('href')
      
      if (url) {
        // Extracts the number after '--' (e.g., show-tv-hd--130 -> 130)
        const match = url.match(/--(\d+)$/)
        if (match) {
          channels.push({
            lang: 'tr',
            name,
            site_id: match[1]
          })
        }
      }
    })

    return channels
  }
}
