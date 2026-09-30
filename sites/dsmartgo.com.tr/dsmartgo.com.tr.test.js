const { parser, url, channels } = require('./dsmartgo.com.tr.config.js')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')
const customParseFormat = require('dayjs/plugin/customParseFormat')
dayjs.extend(customParseFormat)
dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-01', 'YYYY-MM-DD').startOf('d')
const channel = {
  site_id: '246030',
  xmltv_id: 'ATV.tr'
}

it('can generate valid url', () => {
  expect(url({ channel, date })).toBe(
    'https://global-epg-prod.erstream.com/Epg/GetChannelEpgWithRange?includeEnding=false&fillResponse=false&key=pln1jFxpWu1AMwtH1PIU&cmsId=246030&startDate=2026-10-01&endDate=2026-10-02&timezone=00&lang=tr'
  )
})

it('can parse response', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '__data__/content.json'), 'utf8')
  const results = parser({ content, channel, date }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  // previous-day programme and filler placeholder are skipped
  expect(results.length).toBe(10)
  expect(results[0]).toMatchObject({
    title: 'Altı Üstü Istanbul',
    start: '2026-10-01T00:00:00.000Z',
    stop: '2026-10-01T02:30:00.000Z'
  })
  expect(results[0].description).toContain('kenar mahallelerinde')
  expect(results[9]).toMatchObject({
    title: 'Güneşin Doğduğu Yer',
    start: '2026-10-01T20:20:00.000Z',
    stop: '2026-10-01T23:20:00.000Z'
  })
})

it('can handle empty guide', () => {
  const content = fs.readFileSync(path.resolve(__dirname, '__data__/no_content.json'), 'utf8')
  expect(parser({ content, channel, date })).toMatchObject([])
  expect(parser({ content: '', channel, date })).toMatchObject([])
})

it('can parse channel list', async () => {
  axios.post.mockResolvedValue({
    data: JSON.parse(fs.readFileSync(path.resolve(__dirname, '__data__/channels.json'), 'utf8'))
  })
  const results = await channels()
  expect(results).toMatchObject([
    { lang: 'tr', site_id: '245931', name: 'Kanal D' },
    { lang: 'tr', site_id: '246030', name: 'ATV' }
  ])
})
