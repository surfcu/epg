const tls = require('tls')
const http = require('http')
const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc')

dayjs.extend(utc)

jest.mock('axios')

// fake TLS handshake: the server's certificate is either fully trusted or missing its intermediate
function mockHandshake({ authorized, issuerUrls = [] }) {
  return jest.spyOn(tls, 'connect').mockImplementation(() => {
    const socket = new EventEmitter()
    socket.setTimeout = jest.fn()
    socket.end = jest.fn()
    socket.destroy = jest.fn()
    socket.authorized = authorized
    socket.getPeerCertificate = () => ({ infoAccess: { 'CA Issuers - URI': issuerUrls } })
    process.nextTick(() => socket.emit('secureConnect'))
    return socket
  })
}

function mockDownload(body) {
  return jest.spyOn(http, 'get').mockImplementation((url, options, callback) => {
    const res = new EventEmitter()
    res.statusCode = 200
    res.resume = jest.fn()
    const req = new EventEmitter()
    process.nextTick(() => {
      callback(res)
      res.emit('data', body)
      res.emit('end')
    })
    return req
  })
}

const { parser, url, channels, request } = require('./turksatkablo.com.tr.config.js')

const date = dayjs.utc('2026-10-03', 'YYYY-MM-DD').startOf('d')
const channel = { site_id: '22', xmltv_id: 'TRT1.tr@SD' }
const content = fs.readFileSync(path.resolve(__dirname, '__data__/content.json'))
const detail = fs.readFileSync(path.resolve(__dirname, '__data__/detail.html'), 'utf8')
const headers = { 'last-modified': 'Fri, 02 Oct 2026 12:47:18 GMT' }

afterEach(() => {
  jest.restoreAllMocks()
})

beforeEach(() => {
  mockHandshake({ authorized: true })
  axios.get.mockReset()
  axios.get.mockImplementation(url => {
    if (
      url ===
      'https://www.turksatkablo.com.tr/yayin-akisi-program-detay.aspx?d=3&m=10&y=2026&kID=22&eID=2217316418'
    ) {
      return Promise.resolve({ data: detail })
    }
    if (url.includes('yayin-akisi-program-detay.aspx')) {
      return Promise.reject(new Error('404'))
    }
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
})

it('can generate valid url', async () => {
  mockHandshake({ authorized: true })
  expect(await url({ date })).toBe('https://www.turksatkablo.com.tr/userUpload/EPG/3.json')
  expect(await url({ date: dayjs.utc('2026-10-28') })).toBe(
    'https://www.turksatkablo.com.tr/userUpload/EPG/28.json'
  )
  // complete chain: the agent keeps the system CAs
  expect(request.httpsAgent.options.ca).toBeUndefined()
})

it('rejects an intermediate certificate that no system root signed', async () => {
  await jest.isolateModulesAsync(async () => {
    const config = require('./turksatkablo.com.tr.config.js')
    const error = jest.spyOn(console, 'error').mockImplementation(jest.fn())
    mockHandshake({ authorized: false, issuerUrls: ['http://ca.example/intermediate.crt'] })
    const download = mockDownload(
      fs.readFileSync(path.resolve(__dirname, '__data__/untrusted-ca.der'))
    )

    // still returns the url so the grab carries on; the request itself will then fail as before
    expect(await config.url({ date })).toBe('https://www.turksatkablo.com.tr/userUpload/EPG/3.json')
    expect(download).toHaveBeenCalledTimes(1)
    expect(config.request.httpsAgent.options.ca).toBeUndefined()
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not complete the certificate chain'))
  })
})

it('can parse response', async () => {
  const results = (await parser({ content, headers, channel, date })).map(p => {
    p.start = p.start.toJSON()
    p.stop = p.stop.toJSON()
    return p
  })

  // the "-" placeholder (yesterday's programme after midnight) is skipped
  expect(results.length).toBe(5)
  expect(results[0]).toMatchObject({
    title: 'Alparslan: Büyük Selçuklu',
    description:
      "Selçuklu hükümdarı Alparslan, Anadolu'nun kapılarını Türklere açmak ve devletinin gücünü artırmak için zorlu bir mücadeleye girişir.",
    image: 'https://images.media-press.cloud/a01d73f030c247428a7ac6dbea7abf0b',
    icon: 'https://images.media-press.cloud/a01d73f030c247428a7ac6dbea7abf0b',
    start: '2026-10-02T23:55:00.000Z',
    stop: '2026-10-03T02:28:00.000Z'
  })
  // a failed details page still yields the programme, without description/image
  expect(results[4]).toMatchObject({
    title: 'Gönül Dağı',
    description: null,
    image: null,
    icon: null,
    start: '2026-10-03T17:00:00.000Z',
    stop: '2026-10-03T21:15:00.000Z'
  })
})

it('handles a programme that starts at 23:45 and ends after midnight', async () => {
  const results = await parser({ content, headers, channel: { site_id: '2' }, date })
  expect(results.map(p => p.title)).toEqual(['Gece Gelen', 'Sessizliğin Sesi', 'Aşk İşaretleri'])
  expect(results[2].start.toJSON()).toBe('2026-10-03T20:45:00.000Z')
  expect(results[2].stop.toJSON()).toBe('2026-10-03T22:45:00.000Z')
})

it('ignores a file left over from last month', async () => {
  const stale = { 'last-modified': 'Thu, 03 Sep 2026 12:47:18 GMT' }
  expect(await parser({ content, headers: stale, channel, date })).toMatchObject([])
  expect(axios.get).not.toHaveBeenCalled()
})

it('can handle empty guide', async () => {
  expect(await parser({ content: '', headers, channel, date })).toMatchObject([])
  expect(
    await parser({ content: '<!DOCTYPE html><html></html>', headers, channel, date })
  ).toMatchObject([])
  expect(await parser({ content, headers, channel: { site_id: '9999' }, date })).toMatchObject([])
})

it('can parse channel list', async () => {
  axios.get.mockResolvedValue({ data: content.toString() })
  const results = await channels()
  // 900 is an exact copy of 22 and is dropped
  expect(results).toEqual([
    { lang: 'tr', site_id: '2', name: 'Sinema TV' },
    { lang: 'tr', site_id: '22', name: 'TRT 1' }
  ])
})
