// 大肥鱼语音桌面宠物 —— Host 侧插件
// 形态（照抄 dsh-whale-widget 已验证可行的通道）：
//   ① 注册静态路由 /dsh-pet/pet.js，把浏览器脚本喂给页面；
//   ② tapIndex（web 形态）+ webserver/index-inject（桌面端形态）把 <script> 塞进 index.html；
//   ③ POST /dsh-pet/asr：优先用 DSH 官方 speechToText 服务（SenseVoice 本地模型，准），
//      官方服务还没准备好时退回 Windows SAPI（System.Speech）本地识别；
//   ④ GET /dsh-pet/tts/voices + POST /dsh-pet/tts：Windows SAPI 合成 WAV，音色可选、语速可调；
//   ⑤ /dsh-pet/gpt/*：一键下载解压 GPT-SoVITS 整合包并拉起 api_v2.py（音色克隆用）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as gpt from './gpt-installer.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const SCRIPT_PATH = path.join(PACKAGE_ROOT, 'client.js')
const ROUTE = '/dsh-pet/pet.js'
const ASR_ROUTE = '/dsh-pet/asr'
const ASR_STATUS_ROUTE = '/dsh-pet/asr/status'
const ASR_PREPARE_ROUTE = '/dsh-pet/asr/prepare'
const TTS_ROUTE = '/dsh-pet/tts'
const TTS_CUSTOM_ROUTE = '/dsh-pet/tts/custom'
const GPT_STATUS_ROUTE = '/dsh-pet/gpt/status'
const GPT_INSTALL_ROUTE = '/dsh-pet/gpt/install'
const GPT_START_ROUTE = '/dsh-pet/gpt/start'
const GPT_CANCEL_ROUTE = '/dsh-pet/gpt/cancel'
const TTS_VOICES_ROUTE = '/dsh-pet/tts/voices'
const TMP_DIR = path.join(os.tmpdir(), 'dsh-pet-voice')

// 桌面端（Electron）注入行：内联脚本自己建 <script src>，吞掉 onerror，宿主不因我们起不来
const DESKTOP_ROW_TEXT =
  '(function(){try{var d=document.body||document.head||document.documentElement;if(!d)return;' +
  'var s=document.createElement("script");s.src="' + ROUTE + '";' +
  's.onerror=function(){};d.appendChild(s)}catch(e){}})()'

// —— Windows SAPI 离线识别脚本（写成临时 .ps1，避免命令行的引号地狱）——
// zh-CN 的识别引擎是「MS-2052-80-DESK」；DictationGrammar 支持自由说话。
const PS_ASR = [
  'param([string]$WavPath, [string]$Culture)',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$rec = $null',
  'try {',
  '  if ($Culture) { $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine ([System.Globalization.CultureInfo]$Culture) }',
  '} catch { $rec = $null }',
  'if ($null -eq $rec) { $rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine }',
  '$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
  '$rec.SetInputToWaveFile($WavPath)',
  '$sb = New-Object System.Text.StringBuilder',
  'try {',
  '  while ($true) {',
  '    $r = $rec.Recognize()',
  '    if ($null -eq $r) { break }',
  '    [void]$sb.Append($r.Text)',
  '  }',
  '} catch { }',
  'try { $rec.Dispose() } catch { }',
  '[Console]::Out.Write($sb.ToString())',
].join('\r\n')

// —— 列出已安装的 Windows 语音合成音色 ——
const PS_VOICES = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$s.GetInstalledVoices() | ForEach-Object {',
  '  if ($_.Enabled) {',
  '    $i = $_.VoiceInfo',
  '    [Console]::Out.WriteLine($i.Name + "|" + $i.Culture.Name + "|" + $i.Gender)',
  '  }',
  '}',
  '$s.Dispose()',
].join('\r\n')

// —— 用指定音色把文字合成 WAV（24k/16bit/单声道）——
// 走 SSML，这样除了换音色，还能单独调「音调 pitch」——同一个慧慧用不同音调就是不同「人」。
const PS_TTS = [
  'param([string]$Text, [string]$Voice, [int]$RatePct, [int]$Pitch, [string]$Out)',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  'if ($RatePct -lt -10) { $RatePct = -10 }',
  'if ($RatePct -gt 10) { $RatePct = 10 }',
  '$s.Rate = $RatePct',
  'if ($Voice) { try { $s.SelectVoice($Voice) } catch { } }',
  'if ($Pitch -lt -50) { $Pitch = -50 }',
  'if ($Pitch -gt 50) { $Pitch = 50 }',
  '$esc = $Text -replace "&", "&amp;" -replace "<", "&lt;" -replace ">", "&gt;"',
  '$pitchStr = "+" + $Pitch + "%"',
  '$ssml = "<speak version=`"1.0`" xml:lang=`"zh-CN`" xmlns=`"http://www.w3.org/2001/10/synthesis`"><prosody pitch=`"$pitchStr`">$esc</prosody></speak>"',
  '$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
  '$s.SetOutputToWaveFile($Out, $fmt)',
  'try { $s.SpeakSsml($ssml) } catch { $s.Speak($Text) }',
  '$s.Dispose()',
  '[Console]::Out.Write("ok")',
].join('\r\n')

function readPetScript() {
  try {
    return fs.readFileSync(SCRIPT_PATH, 'utf8')
  } catch (err) {
    return '/* pet.js missing: ' + String((err && err.message) || err).replace(/\*\//g, '') + ' */'
  }
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体太大'))
        try { req.destroy() } catch (e) {}
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function ensureTmpDir() {
  try { fs.mkdirSync(TMP_DIR, { recursive: true }) } catch (e) {}
  return TMP_DIR
}

function tmpName(ext) {
  return path.join(ensureTmpDir(), 'p' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext)
}

function psExe() {
  return process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
}

// 跑一段 PowerShell：脚本内容写临时文件，参数走 argv，stdout 当 UTF-8 文本取回
function runPowerShell(name, scriptText, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(ensureTmpDir(), name + '.ps1')
    try { fs.writeFileSync(scriptPath, scriptText, 'utf8') } catch (err) { reject(err); return }
    let child
    try {
      child = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], { windowsHide: true })
    } catch (e) { reject(e); return }
    let out = ''
    let errOut = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => { out += d })
    child.stderr.on('data', (d) => { errOut += d })
    const timer = setTimeout(() => {
      try { child.kill() } catch (e) {}
      reject(new Error(name + ' 超时'))
    }, timeoutMs || 30000)
    child.on('error', (e) => { clearTimeout(timer); reject(e) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !String(out || '').trim()) {
        const tail = (errOut || '').trim().split('\n').slice(-3).join(' ').slice(0, 300)
        reject(new Error(tail || (name + ' 退出码 ' + code)))
        return
      }
      resolve(String(out || ''))
    })
  })
}

let asrBusy = false
let ttsBusy = 0
let prepareStarted = false

export default {
  name: 'pet-voice',
  apply(root) {
    const disposers = []
    root.effect(() => () => {
      for (const d of disposers) {
        try { d() } catch (err) {}
      }
    })

    // 官方语音识别服务（装了 dsh-experimental-voice-input-bundle 才有）
    let speech = null
    try {
      root.inject(['speechToText'], (ctx) => {
        speech = ctx.speechToText
        try {
          ctx.effect(() => () => { if (speech === ctx.speechToText) speech = null })
        } catch (e) {}
      })
    } catch (e) {}

    const sttSnapshot = () => {
      try { return speech ? speech.snapshot() : null } catch (e) { return null }
    }
    const sttProvider = (snap) => {
      const id = snap && snap.selection && snap.selection.providerId
      if (!snap || !Array.isArray(snap.providers)) return null
      return snap.providers.find((x) => x && x.id === id) || null
    }
    const sttPhase = (snap) => {
      const p = sttProvider(snap)
      if (!p) return 'missing'
      return (p.preparation && p.preparation.phase) || 'ready'
    }
    const sttProgress = (snap) => {
      const p = sttProvider(snap)
      const prep = (p && p.preparation) || {}
      const done = typeof prep.completedBytes === 'number' ? prep.completedBytes : null
      const total = typeof prep.totalBytes === 'number' ? prep.totalBytes : null
      return {
        engine: speech ? 'sensevoice' : 'sapi',
        phase: prep.phase || (speech ? 'ready' : 'missing'),
        provider: (p && p.id) || null,
        resource: prep.resource || null,
        percent: done !== null && total ? Math.round((done / total) * 100) : null,
        message: prep.message || null,
        error: prep.error ? String(prep.error).slice(0, 200) : null,
      }
    }
    const startPrepare = () => {
      if (!speech || prepareStarted) return
      const snap = sttSnapshot()
      const id = snap && snap.selection && snap.selection.providerId
      if (!id) return
      prepareStarted = true
      try {
        // 服务签名：prepare(providerId, options) —— 只传 options 会抛「provider unavailable」
        speech.prepare(id, {})
      } catch (err) {
        prepareStarted = false
        try { console.warn('[pet-voice] 启动语音模型下载失败：' + String((err && err.message) || err)) } catch (e2) {}
      }
    }

    async function transcribeWithSpeech(wavBuf) {
      const spec = speech.resolve({ audio: wavBuf, language: 'auto' })
      const result = await speech.transcribe(spec, AbortSignal.timeout(60000))
      return result && typeof result.text === 'string' ? result.text : ''
    }

    // ① 桌面端唯一通道：结构化注入行（宿主启动时一次性收集）
    disposers.push(root.on('webserver/index-inject', (table) => {
      try {
        if (!Array.isArray(table)) return
        for (const row of table) {
          if (!row) continue
          if (row.kind === 'script-src' && row.src === ROUTE) return
          if (row.kind === 'script' && typeof row.text === 'string' && row.text.indexOf(ROUTE) >= 0) return
        }
        table.push({ kind: 'script', placement: 'body', text: DESKTOP_ROW_TEXT })
      } catch (err) {}
    }))

    // ② web 形态：注册路由 + 改写 index.html
    root.inject(['webServer'], (ctx) => {
      const webServer = ctx.webServer
      if (!webServer || typeof webServer.register !== 'function') return

      const json = (res, code, obj) => {
        try {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify(obj))
        } catch (e) {}
      }

      const register = (route, label) => {
        try {
          disposers.push(webServer.register(route))
        } catch (err) {
          try { console.warn('[pet-voice] ' + label + ' 注册失败：' + String((err && err.message) || err)) } catch (e2) {}
        }
      }

      register({
        kind: 'exact',
        path: ROUTE,
        handler: (req, res) => {
          try {
            res.writeHead(200, {
              'Content-Type': 'application/javascript; charset=utf-8',
              'Cache-Control': 'no-store',
            })
            res.end(readPetScript())
          } catch (err) {
            try { res.writeHead(500); res.end('') } catch (e2) {}
          }
        },
      }, 'pet.js')

      // —— 识别状态：现在走哪个引擎、模型下到几成 ——
      register({
        kind: 'exact',
        path: ASR_STATUS_ROUTE,
        handler: (req, res) => {
          json(res, 200, { ok: true, ...sttProgress(sttSnapshot()) })
        },
      }, 'asr-status')

      // —— 触发官方模型下载（约 240MB，一次性，下完就永久本地识别）——
      register({
        kind: 'exact',
        path: ASR_PREPARE_ROUTE,
        handler: (req, res) => {
          if (!speech) { json(res, 200, { ok: false, error: 'no-service' }); return }
          startPrepare()
          json(res, 200, { ok: true, ...sttProgress(sttSnapshot()) })
        },
      }, 'asr-prepare')

      // —— 识别：SenseVoice 优先，SAPI 兜底 ——
      register({
        kind: 'exact',
        path: ASR_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          if (asrBusy) { json(res, 429, { ok: false, error: 'busy' }); return }
          asrBusy = true
          const url = new URL(req.url || '', 'http://127.0.0.1')
          const culture = (url.searchParams.get('lang') || 'zh-CN').slice(0, 16)
          let wavPath = ''
          try {
            const body = await readBody(req, 20 * 1024 * 1024)
            if (!body.length) { json(res, 400, { ok: false, error: 'empty-audio' }); return }

            const snap = sttSnapshot()
            const phase = sttPhase(snap)
            const senseReady = !!speech && (phase === 'ready' || phase === 'standby')

            // 官方模型还没下好：一边后台下载，一边先让 SAPI 顶着认（不能让人白说）
            const prepInfo = {}
            if (speech && !senseReady) {
              startPrepare()
              Object.assign(prepInfo, { preparing: true, ...sttProgress(snap) })
            }

            if (senseReady) {
              try {
                const text = (await transcribeWithSpeech(body)).trim()
                json(res, 200, { ok: true, text, engine: 'sensevoice', lang: 'auto' })
                return
              } catch (err) {
                // 官方服务出错（模型没加载/队列满）时退回 SAPI，别让用户白说
                try { console.warn('[pet-voice] sensevoice 失败，退回 SAPI：' + String((err && err.message) || err)) } catch (e2) {}
              }
            }

            wavPath = tmpName('.wav')
            fs.writeFileSync(wavPath, body)
            const text = (await runPowerShell('asr', PS_ASR, ['-WavPath', wavPath, '-Culture', culture], 40000)).trim()
            json(res, 200, { ok: true, text, engine: 'sapi', lang: culture, ...prepInfo })
          } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          } finally {
            asrBusy = false
            if (wavPath) { try { fs.unlinkSync(wavPath) } catch (e) {} }
          }
        },
      }, 'asr')

      // —— 可用音色列表（Windows SAPI）——
      register({
        kind: 'exact',
        path: TTS_VOICES_ROUTE,
        handler: async (req, res) => {
          try {
            const out = await runPowerShell('voices', PS_VOICES, [], 20000)
            const voices = String(out || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
              const parts = line.split('|')
              return { name: parts[0] || '', culture: parts[1] || '', gender: parts[2] || '' }
            })
            json(res, 200, { ok: true, voices })
          } catch (err) {
            json(res, 200, { ok: false, error: String((err && err.message) || err).slice(0, 300), voices: [] })
          }
        },
      }, 'tts-voices')

      // —— 合成语音（返回 WAV 字节）——
      register({
        kind: 'exact',
        path: TTS_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          if (ttsBusy > 2) { json(res, 429, { ok: false, error: 'busy' }); return }
          ttsBusy++
          let outPath = ''
          try {
            const body = await readBody(req, 1024 * 1024)
            let payload = {}
            try { payload = JSON.parse(body.toString('utf8') || '{}') } catch (e) { payload = {} }
            const text = String(payload.text || '').slice(0, 4000)
            if (!text.trim()) { json(res, 400, { ok: false, error: 'empty-text' }); return }
            const rateNum = Number(payload.rate)
            const rate = Number.isFinite(rateNum) ? Math.max(-10, Math.min(10, Math.round((rateNum - 1) * 10))) : 0
            const pitchNum = Number(payload.pitch)
            const pitch = Number.isFinite(pitchNum) ? Math.max(-50, Math.min(50, Math.round(pitchNum))) : 0
            const voice = String(payload.voice || '').replace(/[^\w\s.\-]/g, '')
            outPath = tmpName('.wav')
            await runPowerShell('tts', PS_TTS, ['-Text', text, '-Voice', voice, '-RatePct', String(rate), '-Pitch', String(pitch), '-Out', outPath], 45000)
            const buf = fs.readFileSync(outPath)
            try {
              res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
              res.end(buf)
            } catch (e) {}
          } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          } finally {
            ttsBusy--
            if (outPath) { try { fs.unlinkSync(outPath) } catch (e) {} }
          }
        },
      }, 'tts')

      // —— 自定义 TTS 代理：把任意「返回音频字节」的服务（GPT-SoVITS / CosyVoice /
      //    OpenAI 兼容 /v1/audio/speech …）接到宠物上，浏览器只管播 ——
      register({
        kind: 'exact',
        path: TTS_CUSTOM_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          try {
            const body = await readBody(req, 512 * 1024)
            let payload = {}
            try { payload = JSON.parse(body.toString('utf8') || '{}') } catch (e) { payload = {} }
            const text = String(payload.text || '').slice(0, 4000)
            const endpoint = String(payload.endpoint || '').trim()
            if (!text.trim()) { json(res, 400, { ok: false, error: 'empty-text' }); return }
            if (!/^https?:\/\//i.test(endpoint)) {
              json(res, 400, { ok: false, error: 'bad-endpoint', hint: '地址要以 http:// 或 https:// 开头' })
              return
            }
            const model = String(payload.model || '').replace(/"/g, '')
            const voice = String(payload.voice || '').replace(/"/g, '')
            const refAudio = String(payload.refAudio || '')
            const promptText = String(payload.promptText || '')
            const GPT_SOVITS_TPL = '{"text":"{{text}}","text_lang":"zh","ref_audio_path":"{{refAudio}}","prompt_text":"{{promptText}}","prompt_lang":"zh","media_type":"wav","streaming_mode":false,"text_split_method":"cut5","speed_factor":1.0}'
            const OPENAI_TPL = '{"model":"{{model}}","input":"{{text}}","voice":"{{voice}}","response_format":"mp3"}'
            // 没填模板时：给了参考音频就当 GPT-SoVITS 用，否则按 OpenAI 兼容形状
            const tpl = String(payload.bodyTemplate || '').trim()
              || (refAudio.trim() ? GPT_SOVITS_TPL : OPENAI_TPL)
            // 填进去的值都要 JSON 转义，否则带引号/换行/反斜杠会把请求体搞坏
            const esc = (v) => JSON.stringify(String(v)).slice(1, -1)
            const escaped = esc(text)
            let bodyText = tpl.split('{{text}}').join(escaped)
              .split('{{refAudio}}').join(esc(refAudio))
              .split('{{promptText}}').join(esc(promptText))
              .split('{{model}}').join(esc(model))
              .split('{{voice}}').join(esc(voice))
            try { JSON.parse(bodyText) } catch (e) {
              bodyText = JSON.stringify({ text, model, voice })
            }
            const headers = { 'Content-Type': 'application/json' }
            const key = String(payload.apiKey || '').trim()
            if (key) headers.Authorization = 'Bearer ' + key
            const resp = await fetch(endpoint, {
              method: 'POST',
              headers,
              body: bodyText,
              signal: AbortSignal.timeout(60000),
            })
            if (!resp.ok) {
              const detail = await resp.text().catch(() => '')
              json(res, 502, { ok: false, error: 'HTTP ' + resp.status, detail: String(detail).slice(0, 300) })
              return
            }
            const audio = Buffer.from(await resp.arrayBuffer())
            if (!audio.length) { json(res, 502, { ok: false, error: 'empty-audio' }); return }
            const type = resp.headers.get('content-type') || 'audio/mpeg'
            res.writeHead(200, { 'Content-Type': type, 'Content-Length': audio.length, 'Cache-Control': 'no-store' })
            res.end(audio)
          } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          }
        },
      }, 'tts-custom')

      // —— GPT-SoVITS 一键装：下载整合包 → 解压 → 写启动脚本 → 拉起 api_v2.py ——
      register({
        kind: 'exact',
        path: GPT_STATUS_ROUTE,
        handler: async (req, res) => {
          try { json(res, 200, await gpt.status()) } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          }
        },
      }, 'gpt-status')

      register({
        kind: 'exact',
        path: GPT_INSTALL_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          try {
            const body = await readBody(req, 64 * 1024)
            let payload = {}
            try { payload = JSON.parse(body.toString('utf8') || '{}') } catch (e) { payload = {} }
            const dir = String(payload.dir || '').trim()
            if (dir && !/^[A-Za-z]:[\\/]|^\//.test(dir)) {
              json(res, 400, { ok: false, error: 'bad-dir', hint: '要填绝对路径，例如 D:/GPT-SoVITS' })
              return
            }
            json(res, 200, await gpt.install(dir))
          } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          }
        },
      }, 'gpt-install')

      register({
        kind: 'exact',
        path: GPT_START_ROUTE,
        handler: async (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          try {
            const body = await readBody(req, 64 * 1024)
            let payload = {}
            try { payload = JSON.parse(body.toString('utf8') || '{}') } catch (e) { payload = {} }
            json(res, 200, await gpt.start(String(payload.root || '').trim() || null))
          } catch (err) {
            json(res, 500, { ok: false, error: String((err && err.message) || err).slice(0, 300) })
          }
        },
      }, 'gpt-start')

      register({
        kind: 'exact',
        path: GPT_CANCEL_ROUTE,
        handler: (req, res) => {
          if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'method-not-allowed' }); return }
          json(res, 200, gpt.cancel())
        },
      }, 'gpt-cancel')

      if (typeof webServer.tapIndex === 'function') {
        disposers.push(webServer.tapIndex((html) => {
          try {
            if (typeof html !== 'string') return html
            if (html.indexOf(ROUTE) !== -1) return html
            const tag = '<script defer src="' + ROUTE + '"></script>'
            if (html.indexOf('</body>') !== -1) return html.replace('</body>', tag + '</body>')
            return html + tag
          } catch (err) {
            return html
          }
        }))
      }
    })
  },
}
