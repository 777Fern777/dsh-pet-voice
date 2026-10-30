// 验证 client.js 语法 + 按面板默认值（GPT-SoVITS 参考音频）真实打一次代理端点
import { readFileSync, writeFileSync } from 'node:fs'

const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
new Function(src)
console.log('client.js 语法 OK，字节', Buffer.byteLength(src))

const PORT = process.argv[2] || '59584'
const REF = process.argv[3] || 'D:/GPT-SoVITS-v2pro-20261006/voices/ref_test.wav'
const PROMPT = process.argv[4] || '今天天气不错，我们一起出去玩吧。'

const cfg = { customEndpoint: 'http://127.0.0.1:9880/tts', customRefAudio: REF, customPromptText: PROMPT, customLang: 'auto', customPromptLang: 'ja', ttsRate: 1.05 }
// 与 client.js 里 speakCustom 的模板拼装保持一致
let tpl = cfg.customTemplate || ''
if (!tpl && cfg.customRefAudio) {
  tpl = JSON.stringify({
    text: '{{text}}',
    text_lang: cfg.customLang || 'auto',
    ref_audio_path: cfg.customRefAudio,
    prompt_text: cfg.customPromptText || '',
    prompt_lang: cfg.customPromptLang || 'ja',
    media_type: 'wav',
    streaming_mode: false,
    text_split_method: 'cut5',
    speed_factor: Number(cfg.ttsRate) || 1,
  })
}
const payload = {
  text: '哼，才不是特意为你念的呢，本鱼只是刚好想说话。',
  endpoint: cfg.customEndpoint,
  apiKey: '',
  model: '',
  voice: '',
  refAudio: cfg.customRefAudio,
  promptText: cfg.customPromptText,
  bodyTemplate: tpl,
}
const t0 = Date.now()
const resp = await fetch(`http://127.0.0.1:${PORT}/dsh-pet/tts/custom`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
const buf = Buffer.from(await resp.arrayBuffer())
console.log('status', resp.status, 'type', resp.headers.get('content-type'), 'bytes', buf.length, 'ms', Date.now() - t0)
if (!buf.subarray(0, 4).toString().includes('RIFF')) {
  console.log('不是 WAV：', buf.subarray(0, 200).toString('utf8'))
  process.exit(1)
}
writeFileSync(new URL('./out_gsv_client.wav', import.meta.url), buf)
console.log('写出 test/out_gsv_client.wav')
