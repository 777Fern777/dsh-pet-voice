// 把 client.js 里的「句子流水线」整块抠出来，在 Node 里用假 DOM/Audio 跑一遍，
// 看它到底有没有真的调用播放、有没有报错。
import { readFileSync } from 'node:fs'

const PORT = process.argv[2] || '62237'
const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const start = src.indexOf('// ---------- 句子流水线')
const end = src.indexOf('  function speakClean(text) {')
if (start < 0 || end < 0 || end < start) throw new Error('抠不出流水线代码块')
const block = src.slice(start, end)

const prelude = `
  const cfg = { engine: 'custom', ttsEnabled: true, customEndpoint: 'http://127.0.0.1:9880/tts',
    refAudio: 'D:\\\\GPT-SoVITS-v2pro-20261006\\\\voices\\\\fern_long.wav',
    customPromptText: 'じゃあおいで、いっぱい撫でます。載せていただいてありがとうございました。', ttsRate: 1, pitch: 0, sapiVoice: '' }
  const TTS_URL = '/dsh-pet/tts'
  const TTS_CUSTOM_URL = '/dsh-pet/tts/custom'
  const events = []
  const log = (m) => { events.push(m); console.log(m) }
  const fishEl = { classList: { add: () => log('  · 鱼在动嘴'), remove: () => log('  · 鱼闭嘴') } }
  const engineSel = { value: '' }
  const say = (m) => log('  · 气泡: ' + m)
  const saveCfg = () => {}
  let audioEl = null
  let lastSpeech = { at: 0, chars: 0, state: '' }
  const updateSpeechHint = () => {}
  const logSpeech = (m) => log('  · log: ' + m)
  let muteWarned = false
  const speakBrowser = (t) => log('  · 浏览器声音替代: ' + String(t).slice(0, 16))
  const stripForSpeech = (t) => String(t || '').replace(/[#*\`]/g, '').trim()
  const sanitizeAnswer = (t) => String(t || '').trim()
  const hashText = (s) => { let h = 5381; const x = String(s || ''); for (let i = 0; i < x.length; i++) h = ((h << 5) + h + x.charCodeAt(i)) | 0; return h + ':' + x.length }
  function customPayload(text) {
    return {
      text: String(text || ''), endpoint: cfg.customEndpoint, apiKey: '', model: '', voice: '',
      refAudio: cfg.refAudio, promptText: cfg.customPromptText,
      bodyTemplate: JSON.stringify({ text: '{{text}}', text_lang: 'auto', ref_audio_path: '{{refAudio}}',
        prompt_text: '{{promptText}}', prompt_lang: 'ja', media_type: 'wav', streaming_mode: false,
        text_split_method: 'cut5', speed_factor: 1 })
    }
  }
  const BASE = 'http://127.0.0.1:' + PORT_ARG
  async function fakeFetch(url, opts) {
    const full = String(url).startsWith('http') ? url : BASE + url
    const res = await realFetch(full, opts)
    if (!res.ok) return res
    const ab = await res.arrayBuffer()
    return {
      ok: true, status: res.status,
      blob: async () => ({ __ms: Math.max(300, Math.round((ab.byteLength - 44) / 64)) }),
      text: async () => ''
    }
  }
  const URL_SHIM = { createObjectURL: (blob) => 'audio#' + Math.round(blob.__ms), revokeObjectURL: () => {} }
  const stoppedKeys = new Map()
  const fetch = fakeFetch
`

const tail = `
  return { splitForSpeech, feedSpeech, speechQueue, events }
`

const fn = new Function('realFetch', 'Audio', 'URL', 'PORT_ARG', prelude + block + tail)

// 假 Audio：play() 返回 Promise，按时长后触发 onended，和浏览器一致
class FakeAudio {
  constructor(url) { this.url = url; this.onended = null; this.onerror = null }
  play() {
    const ms = Number(String(this.url).split('#')[1]) || 1000
    console.log(`  · 播放开始（${ms}ms 音频）`)
    const self = this
    return new Promise((resolve) => {
      resolve()
      setTimeout(() => { console.log('  · 播放结束'); self.onended && self.onended() }, ms)
    })
  }
  pause() {}
}

const api = fn((url, opts) => fetch(url, opts), FakeAudio, { createObjectURL: (b) => 'audio#' + Math.round(b.__ms), revokeObjectURL: () => {} }, PORT)

const text = process.env.PET_TEXT || '上海今天十七到二十四度，多云，上午转晴到多云，局部有雾。早晚有点凉，出门带件薄外套就行。如果你要骑车上学，注意慢一点。'
const t0 = Date.now()
console.log('切句：', api.splitForSpeech(text).map((c, i) => `[${i}] ${c}`).join(' | '))
api.feedSpeech('k1', text.slice(0, 20), false)
await new Promise((r) => setTimeout(r, 150))
api.feedSpeech('k1', text, false)
await new Promise((r) => setTimeout(r, 150))
api.feedSpeech('k1', text, true)
await new Promise((r) => setTimeout(r, 15000))
console.log('\n队列剩余：', api.speechQueue.length, ' 总耗时：', Date.now() - t0, 'ms')
