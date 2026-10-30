// ASR 端到端自检：把 TTS 生成的 WAV 喂给插件的 /dsh-pet/asr 路由，看能不能识别出中文。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import plugin from '../index.js'

const wavPath = process.argv[2] || path.join(os.tmpdir(), 'dsh-pet-test', 'tts.wav')
if (!fs.existsSync(wavPath)) {
  console.error('找不到测试音频：' + wavPath)
  process.exit(1)
}

const routes = {}
const ctx = {
  webServer: {
    register(route) { routes[route.path] = route; return () => {} },
    tapIndex() { return () => {} },
  },
}
plugin.apply({ effect(fn) { fn() }, on() {}, inject(_s, cb) { cb(ctx) } })

const body = fs.readFileSync(wavPath)
const started = Date.now()
const req = {
  method: 'POST',
  url: '/dsh-pet/asr?lang=zh-CN',
  on(ev, cb) {
    if (ev === 'data') cb(body)
    if (ev === 'end') setImmediate(cb)
  },
  destroy() {},
}
const res = {
  writeHead(code) { this.code = code },
  end(s) {
    console.log('HTTP', this.code, s)
    console.log('耗时', Date.now() - started, 'ms')
    const j = JSON.parse(s)
    if (!j.ok) process.exit(2)
    if (!j.text) { console.error('❌ 识别结果为空'); process.exit(3) }
    console.log('✅ 识别文本：' + j.text)
  },
}
routes['/dsh-pet/asr'].handler(req, res)
