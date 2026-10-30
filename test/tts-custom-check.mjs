// 离线自检：自定义 TTS 代理路由（不联网，起一个本地假服务）
// 覆盖：client.js 语法、/dsh-pet/tts/custom 转发、{{text}} 里的引号/换行转义、错误分支。
import assert from 'node:assert'
import http from 'node:http'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import plugin from '../index.js'

// ① client.js 必须是能解析的纯脚本
const clientUrl = new URL('../client.js', import.meta.url)
const clientSrc = fs.readFileSync(clientUrl, 'utf8')
try {
  new Function(clientSrc)
} catch (err) {
  throw new Error('client.js 语法错误：' + err.message)
}
assert.ok(!/^\s*import\s/m.test(clientSrc), 'client.js 不能含 ESM import')
assert.ok(!clientSrc.includes('\nexport '), 'client.js 不能含 export')

// ② 装插件，抓路由
const handlers = []
const fakeCtx = {
  webServer: { register(route) { handlers.push(route); return () => {} }, tapIndex() { return () => {} } },
}
const root = {
  effect(fn) { fn() },
  on() {},
  inject(_s, cb) { cb(fakeCtx) },
}
plugin.apply(root)

const custom = handlers.find((h) => h.path === '/dsh-pet/tts/custom')
assert.ok(custom, '缺少 /dsh-pet/tts/custom 路由')

function call(handler, payload) {
  return new Promise((resolve, reject) => {
    const req = Readable.from([Buffer.from(JSON.stringify(payload), 'utf8')])
    req.method = 'POST'
    req.url = '/dsh-pet/tts/custom'
    let body = null
    const res = {
      writeHead(code, headers) { this.code = code; this.headers = headers || {} },
      end(chunk) { body = chunk === undefined ? Buffer.alloc(0) : Buffer.from(chunk); resolve({ code: this.code || 200, headers: this.headers || {}, body }) },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

// ③ 本地假 TTS：回一段假音频，并记录收到的请求体/头
const AUDIO = Buffer.from('RIFFxxxxWAVEfake-audio-bytes')
let seen = null
const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    seen = { headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }
    res.writeHead(200, { 'Content-Type': 'audio/wav' })
    res.end(AUDIO)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

const tricky = '他说：“你好”，\n第二行，带\\反斜杠'

const ok = await call(custom.handler, {
  text: tricky,
  endpoint: 'http://127.0.0.1:' + port + '/v1/audio/speech',
  apiKey: 'sk-test',
  model: 'tts-1',
  voice: 'xiaoxin',
})
assert.equal(ok.code, 200, '成功分支应返回 200，实际 ' + ok.code)
assert.equal(ok.headers['Content-Type'], 'audio/wav', '应透传 Content-Type')
assert.ok(ok.body.equals(AUDIO), '应原样返回音频字节')
assert.equal(seen.headers.authorization, 'Bearer sk-test', '应带上 Bearer Key')
const parsed = JSON.parse(seen.body)
assert.equal(parsed.input, tricky, '{{text}} 必须放进 JSON 后仍与原文一致（引号/换行要转义）')
assert.equal(parsed.model, 'tts-1')
assert.equal(parsed.voice, 'xiaoxin')
assert.equal(parsed.response_format, 'mp3')

// ④ 自定义模板也能用
seen = null
const ok2 = await call(custom.handler, {
  text: '你好',
  endpoint: 'http://127.0.0.1:' + port + '/tts',
  bodyTemplate: '{"text":"{{text}}","voice":"{{voice}}","speed":1.0}',
  voice: 'xiaoxin',
})
assert.equal(ok2.code, 200)
const parsed2 = JSON.parse(seen.body)
assert.equal(parsed2.text, '你好')
assert.equal(parsed2.speed, 1.0)
assert.equal(parsed2.voice, 'xiaoxin')

// ⑤ 坏地址 / 空文本
const bad = await call(custom.handler, { text: 'hi', endpoint: 'ftp://x' })
assert.equal(bad.code, 400)
assert.equal(JSON.parse(bad.body.toString()).error, 'bad-endpoint')
const empty = await call(custom.handler, { text: '   ', endpoint: 'http://127.0.0.1:1/x' })
assert.equal(empty.code, 400)
assert.equal(JSON.parse(empty.body.toString()).error, 'empty-text')

server.close()
console.log('✅ 自定义 TTS 代理自检通过：client.js 语法 OK，转发 OK，{{text}} 转义 OK，错误分支 OK')
