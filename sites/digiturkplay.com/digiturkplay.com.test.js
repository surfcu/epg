const { parser, url, request, channels } = require('./digiturkplay.com.config.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-09', 'YYYY-MM-DD').startOf('d')
const channel = { site_id: 'trt-1', xmltv_id: 'TRT1.tr@SD' }
const read = file => fs.readFileSync(path.join(__dirname, '__data__', file))

it('can generate valid url', () => {
  expect(url).toBe('https://www.digiturkplay.com/api/service/tvguides')
})

it('can generate valid request data', () => {
  expect(JSON.parse(request.data({ channel, date }))).toEqual({
    path: '/api/v1/broadcast/tvguides',
    body: {
      startTime: '2026-10-09T00:00:00.000Z',
      endTime: '2026-10-09T23:59:59.999Z',
      channelSlugs: ['trt-1']
    }
  })
})

it('can parse response', () => {
  const results = parser({ content: read('content.json'), channel, date }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  // Mehmed (22:40 local on the 8th) belongs to the previous day and is skipped
  expect(results.map(p => p.title)).toEqual([
    'Taşacak Bu Deniz',
    'Seksenler',
    'İddiaların Aksine',
    'Taşacak Bu Deniz'
  ])
  expect(results[0]).toMatchObject({
    start: '2026-10-08T22:40:00.000Z',
    stop: '2026-10-09T01:20:00.000Z'
  })
  expect(results[1]).toMatchObject({
    title: 'Seksenler',
    description: "Türkiye'de 1980'lerin başından günümüze yaşanan değişimin hikâyesi..",
    category: ['Komedi'],
    start: '2026-10-09T01:20:00.000Z',
    stop: '2026-10-09T02:45:00.000Z'
  })
  // description equal to the title and internal genre codes are dropped
  expect(results[2]).toMatchObject({ description: null, category: [] })
  // last programme runs past midnight
  expect(results[3]).toMatchObject({
    start: '2026-10-09T17:00:00.000Z',
    stop: '2026-10-09T21:15:00.000Z'
  })
})

it('splits season and episode out of the title', () => {
  const results = parser({
    content: read('content_series.json'),
    channel: { site_id: 'beIN-gurme' },
    date
  })
  expect(results[0]).toMatchObject({
    title: 'Gece Lezzetleri',
    description: "Gece Lezzetleri'nin bu bölümünde Adana'dayız.",
    season: 1,
    episode: 5
  })
})

it('can handle empty guide', () => {
  expect(parser({ content: '', channel, date })).toMatchObject([])
  expect(parser({ content: '{"data":{"items":[]}}', channel, date })).toMatchObject([])
  expect(parser({ content: read('content.json'), channel: { site_id: 'atv' }, date })).toMatchObject([])
})

it('can parse channel list without radio and test channels', async () => {
  axios.post.mockResolvedValue({ data: read('channels.json').toString() })
  expect(await channels()).toEqual([
    { lang: 'tr', site_id: 'beIN-gurme', name: 'beIN GURME HD' },
    { lang: 'tr', site_id: 'trt-1', name: 'TRT 1' }
  ])
})
