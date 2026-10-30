// TTS 路由自检：走 /dsh-pet/tts/voices 与 /dsh-pet/tts，验证音色枚举与 SSML 合成（含音调）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import plugin from '../index.js'

const routes = {}
const ctx = {
  webServer: {
    register(route) { routes[route.path] = route; return () => {} },
    tapIndex() { return () => {} },
  },
}
plugin.apply({ effect(fn) { fn() }, on() {}, inject(_s, cb) { cb(ctx) } })

function call(routePath, body, query) {
  return new Promise((resolve, reject) => {
    const buf = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.alloc(0)
    const req = {
      method: body ? 'POST' : 'GET',
      url: routePath + (query || ''),
      on(ev, cb) {
        if (ev === 'data') cb(buf)
        if (ev === 'end') setImmediate(cb)
      },
      destroy() {},
    }
    const chunks = []
    const res = {
      headers: null,
      writeHead(code, headers) { this.code = code; this.headers = headers },
      end(s) {
        if (typeof s === 'string') resolve({ code: this.code, type: this.headers && this.headers['Content-Type'], json: JSON.parse(s) })
        else { chunks.push(Buffer.from(s)); resolve({ code: this.code, type: this.headers && this.headers['Content-Type'], buf: Buffer.concat(chunks) }) }
      },
    }
    routes[routePath].handler(req, res).catch(reject)
  })
}

const voices = await call('/dsh-pet/tts/voices')
console.log('音色数量：' + voices.json.voices.length)
for (const v of voices.json.voices) console.log('  - ' + v.name + ' | ' + v.culture + ' | ' + v.gender)
if (!voices.json.voices.length) { console.error('❌ 没读到音色'); process.exit(2) }

const zh = voices.json.voices.find((v) => /zh/i.test(v.culture)) || voices.json.voices[0]
const outDir = path.join(os.tmpdir(), 'dsh-pet-test')
fs.mkdirSync(outDir, { recursive: true })

for (const [label, pitch, rate] of [['默认', 0, 1.05], ['低沉', -25, 0.85], ['尖亮', 25, 1.25]]) {
  const started = Date.now()
  const r = await call('/dsh-pet/tts', { text: '哼，本鱼今天也要吃白饭——听见了没有？', voice: zh.name, rate, pitch })
  const ms = Date.now() - started
  if (!r.buf || r.type !== 'audio/wav' || r.buf.length < 1000) {
    console.error('❌ 合成失败：' + label + ' ' + JSON.stringify(r.json || r.buf && r.buf.length))
    process.exit(3)
  }
  const file = path.join(outDir, 'tts-' + label + '.wav')
  fs.writeFileSync(file, r.buf)
  const rateHz = r.buf.readUInt32LE(24)
  console.log('✅ ' + label + '：' + r.buf.length + ' 字节 / ' + ms + 'ms / ' + rateHz + 'Hz -> ' + file)
}
