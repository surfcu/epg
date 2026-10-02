const { parser, url, request } = require('./tvplus.com.tr.config.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-03', 'YYYY-MM-DD').startOf('d')
const channel = { lang: 'tr', site_id: 'fx-hd/131', xmltv_id: 'FX.tr' }

axios.post.mockImplementation(url => {
  if (url === 'https://tvplus.com.tr/get-platform-info') {
    return Promise.resolve({ data: { https: 'https://gbzottvsc17.tvplus.com.tr:33207/', status: 'ok' } })
  }
  if (url === 'https://gbzottvsc17.tvplus.com.tr:33207/EPG/JSON/Authenticate') {
    return Promise.resolve({
      headers: { 'set-cookie': ['JSESSIONID=abc123; Path=/; Secure; HttpOnly'] },
      data: { retcode: '0', retmsg: 'success' }
    })
  }
  return Promise.reject(new Error(`unexpected POST ${url}`))
})

it('can generate valid url', async () => {
  expect(await url({ channel, date })).toBe(
    'https://gbzottvsc17.tvplus.com.tr:33207/EPG/JSON/PlayBillList'
  )
})

it('can generate valid request headers', async () => {
  const headers = await request.headers({ channel, date })
  expect(headers.Cookie).toBe('JSESSIONID=abc123')
  expect(headers['Content-Type']).toBe('application/json')
})

it('can generate valid request data', () => {
  expect(request.data({ channel, date })).toEqual({
    type: '2',
    channelid: '131',
    begintime: '20261002210000',
    endtime: '20261003210000',
    isFillProgram: 0
  })
})

it('accepts a bare numeric site_id', () => {
  expect(request.data({ channel: { site_id: '131' }, date }).channelid).toBe('131')
})

it('can parse response', () => {
  const content = fs.readFileSync(path.join(__dirname, '__data__', 'content.json'))
  const results = parser({ date, channel, content }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  expect(results.length).toBe(4) // gap filler dropped
  expect(results[0]).toMatchObject({
    start: '2026-10-02T21:00:00.000Z',
    stop: '2026-10-02T21:45:00.000Z',
    title: 'Castle',
    category: ['Dizi'],
    season: 7,
    episode: 3,
    image:
      'https://gbzottvsc17.tvplus.com.tr:33207/CPS/images/universal/film/program/202609/20260927/9/2204280626275eb88428_0_XL.jpg',
    icon:
      'https://gbzottvsc17.tvplus.com.tr:33207/CPS/images/universal/film/program/202609/20260927/9/2204280626275eb88428_0_XL.jpg'
  })
  expect(results[0].description).toMatch(/^Başarılı cinayet-gizem/)
  expect(results[3]).toMatchObject({
    start: '2026-10-02T23:15:00.000Z',
    stop: '2026-10-03T00:00:00.000Z',
    title: 'High Potential',
    season: 2,
    episode: 3
  })
})

it('can handle empty guide', () => {
  expect(parser({ date, channel, content: '' })).toMatchObject([])
  expect(parser({ date, channel, content: '{"retcode":"-2"}' })).toMatchObject([])
})
