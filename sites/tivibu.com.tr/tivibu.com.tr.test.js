const { parser, url, request } = require('./tivibu.com.tr.config.js')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

const date = dayjs.utc('2026-10-03', 'YYYY-MM-DD').startOf('d')
const channel = { lang: 'tr', site_id: '1258', name: 'SİNEMA TV', xmltv_id: 'SinemaTV.tr@SD' }
const content = fs.readFileSync(path.join(__dirname, '__data__', 'content.json'))

axios.get.mockImplementation(url => {
  if (url === 'https://www.tivibu.com.tr/canli-tv') {
    return Promise.resolve({
      headers: {
        'set-cookie': [
          'TS01de49a5=abc; Path=/',
          '.AspNetCore.Antiforgery.x=def; path=/; samesite=strict; httponly'
        ]
      },
      data: fs.readFileSync(path.join(__dirname, '__data__', 'canli-tv.html'), 'utf8')
    })
  }
  return Promise.reject(new Error(`unexpected GET ${url}`))
})

it('can generate valid url', () => {
  expect(url).toBe('https://www.tivibu.com.tr/Channel/GetPrevueList')
})

it('can generate valid request headers', async () => {
  const headers = await request.headers({ channel, date })
  expect(headers).toMatchObject({
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    Requestverificationtoken: 'CfDJ8test-token',
    Cookie: 'TS01de49a5=abc; .AspNetCore.Antiforgery.x=def'
  })
})

it('can generate valid request data', () => {
  const expected = {
    channelCode: 'ch00000000000000001258',
    channelDateBegin: '2026.10.03 00:00:00',
    channelDateEnd: '2026.10.03 23:59:59'
  }
  expect(Object.fromEntries(new URLSearchParams(request.data({ channel, date })))).toEqual(expected)
  // full channel code works too
  const full = request.data({ channel: { site_id: 'ch00000000000000001258' }, date })
  expect(Object.fromEntries(new URLSearchParams(full))).toEqual(expected)
})

it('can parse response', () => {
  const results = parser({ content, channel, date }).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  // the 23:45 programme from the previous day is skipped
  expect(results.map(p => p.title)).toEqual([
    'Gece Gelen',
    'Sessizliğin Sesi',
    'Christy',
    'Aşk İşaretleri'
  ])
  expect(results[0]).toMatchObject({
    start: '2026-10-02T22:45:00.000Z',
    stop: '2026-10-03T00:30:00.000Z',
    title: 'Gece Gelen',
    category: 'Film',
    rating: { system: 'RTÜK', value: '18+' },
    image: 'https://itv224186.tmp.tivibu.com.tr:6430/images/prevueposter/20260312640884.jpg'
  })
  expect(results[0].description).toMatch(/^Dünyanın bambaşka/)
  expect(results[2]).toMatchObject({
    title: 'Christy',
    description: null,
    rating: { system: 'RTÜK', value: 'Genel İzleyici' }
  })
  // last programme runs past midnight
  expect(results[3]).toMatchObject({
    start: '2026-10-03T20:45:00.000Z',
    stop: '2026-10-03T22:45:00.000Z'
  })
})

it('can handle empty guide', () => {
  expect(parser({ content: '', channel, date })).toMatchObject([])
  expect(parser({ content: '{"mobilPrevueViewModel":[]}', channel, date })).toMatchObject([])
})
