// GPT-SoVITS 一键安装：从国内镜像拉整合包 → 解压 → 写启动脚本 → 拉起 api_v2.py
// 只用 Node 内置能力（fetch + 流 + 7zr.exe），不依赖用户预装任何工具。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const TMP = path.join(os.tmpdir(), 'dsh-pet-voice')
const SEVEN_ZIP_URL = 'https://www.7-zip.org/a/7zr.exe'

// 官方 release 页给的直链：魔搭（国内满速）→ hf 镜像 → 官方 HF
// 想换成自己打包的压缩包时，设环境变量 DSH_PET_GPT_URL 指向它即可（会被排在最前面）。
const CUSTOM_URL = (process.env.DSH_PET_GPT_URL || '').trim()
const SOURCES = [
  ...(CUSTOM_URL ? [{ label: '自定义地址', url: CUSTOM_URL }] : []),
  {
    label: '魔搭 ModelScope',
    url: 'https://www.modelscope.cn/models/FlowerCry/gpt-sovits-7z-pacakges/resolve/master/GPT-SoVITS-v2pro-20250604.7z',
  },
  {
    label: 'hf-mirror',
    url: 'https://hf-mirror.com/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v2pro-20250604.7z',
  },
  {
    label: 'HuggingFace',
    url: 'https://huggingface.co/lj1995/GPT-SoVITS-windows-package/resolve/main/GPT-SoVITS-v2pro-20250604.7z',
  },
]

const job = {
  state: 'idle',        // idle | running | done | error | cancelled
  phase: '',            // downloading | extracting | launching | done
  source: '',
  dir: '',
  bytes: 0,
  total: 0,
  percent: null,
  message: '',
  error: null,
  startedAt: 0,
  finishedAt: 0,
}
let controller = null

const now = () => Date.now()

function setJob(patch) {
  Object.assign(job, patch)
}

function availableBytes(target) {
  try {
    const st = fs.statfsSync(target)
    return Number(st.bavail) * Number(st.bsize)
  } catch (e) {
    return null
  }
}

async function find7z() {
  const candidates = [
    'C:/Program Files/7-Zip/7z.exe',
    'C:/Program Files (x86)/7-Zip/7z.exe',
    path.join(TMP, '7zr.exe'),
  ]
  for (const c of candidates) {
    try {
      await fsp.access(c, fs.constants.X_OK)
      return c
    } catch (e) {}
  }
  return null
}

async function ensure7z(log) {
  const found = await find7z()
  if (found) return found
  await fsp.mkdir(TMP, { recursive: true })
  const dest = path.join(TMP, '7zr.exe')
  log('下载 7zr.exe（约 600KB）……')
  const resp = await fetch(SEVEN_ZIP_URL, { signal: AbortSignal.timeout(120000) })
  if (!resp.ok) throw new Error('7zr.exe 下载失败 HTTP ' + resp.status)
  await fsp.writeFile(dest, Buffer.from(await resp.arrayBuffer()))
  return dest
}

async function downloadTo(url, dest, onProgress, signal) {
  const resp = await fetch(url, { redirect: 'follow', signal })
  if (!resp.ok) throw new Error('HTTP ' + resp.status)
  const total = Number(resp.headers.get('content-length') || 0)
  const body = resp.body
  if (!body) throw new Error('响应没有内容')
  const out = fs.createWriteStream(dest)
  let seen = 0
  let lastTick = 0
  const counter = new (await import('node:stream')).Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length
      const t = now()
      if (t - lastTick > 400) {
        lastTick = t
        onProgress(seen, total)
      }
      cb(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(body), counter, out)
  onProgress(seen, total)
  return seen
}

function run7z(exe, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true })
    let errBuf = ''
    child.stdout.on('data', (d) => onLine && onLine(String(d)))
    child.stderr.on('data', (d) => { errBuf += String(d) })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error('7z 退出码 ' + code + '：' + errBuf.slice(0, 300)))
    })
  })
}

async function locateRoot(dir) {
  const marks = ['api_v2.py', 'GPT_SoVITS']
  async function scan(base, depth) {
    let entries = []
    try { entries = await fsp.readdir(base, { withFileTypes: true }) } catch (e) { return null }
    let hit = 0
    for (const m of marks) if (entries.some((e) => e.name === m)) hit++
    if (hit === marks.length) return base
    if (depth <= 0) return null
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const found = await scan(path.join(base, e.name), depth - 1)
      if (found) return found
    }
    return null
  }
  return scan(dir, 2)
}

async function writeLauncher(rootDir) {
  const bat = [
    '@echo off',
    'cd /d "%~dp0"',
    'echo 正在启动 GPT-SoVITS API（端口 9880）……',
    '"%~dp0runtime\\python.exe" api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml',
    'pause',
  ].join('\r\n')
  const file = path.join(rootDir, 'start-tts-api.bat')
  await fsp.writeFile(file, bat + '\r\n', 'utf8')
  return file
}

export async function apiRunning(port = 9880) {
  try {
    const resp = await fetch('http://127.0.0.1:' + port + '/tts', {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
    })
    return { running: true, status: resp.status }
  } catch (e) {
    return { running: false, error: String((e && e.message) || e).slice(0, 120) }
  }
}

export async function status() {
  const dir = job.dir || defaultDir()
  let installed = false
  let root = null
  let launcher = null
  try {
    root = await locateRoot(dir)
    installed = !!root
    if (root) {
      const cand = path.join(root, 'start-tts-api.bat')
      launcher = fs.existsSync(cand) ? cand : null
    }
  } catch (e) {}
  const api = await apiRunning()
  return {
    ok: true,
    installed,
    dir,
    root,
    launcher,
    api,
    job: { ...job },
    sources: SOURCES.map((s) => s.label),
    diskFreeBytes: availableBytes(dir),
  }
}

export function defaultDir() {
  const override = process.env.DSH_PET_GPT_DIR
  if (override && override.trim()) return override.trim()
  return path.join(os.homedir(), 'GPT-SoVITS')
}

export async function install(dirOverride, options = {}) {
  if (job.state === 'running') return { ok: false, error: '已经有任务在跑了', job: { ...job } }
  const dir = (dirOverride && String(dirOverride).trim()) || defaultDir()
  // 已经装好了就别再下一次 8GB（想重装要显式 force）
  if (!options.force) {
    const existing = await locateRoot(dir)
    if (existing) return { ok: true, already: true, dir, root: existing, job: { ...job } }
  }
  controller = new AbortController()
  const signal = controller.signal
  setJob({
    state: 'running', phase: 'downloading', source: '', dir, bytes: 0, total: 0, percent: null,
    message: '准备中……', error: null, startedAt: now(), finishedAt: 0,
  })

  const log = (msg) => setJob({ message: String(msg).slice(0, 200) })

  ;(async () => {
    let archive = null
    try {
      await fsp.mkdir(dir, { recursive: true })
      const free = availableBytes(dir)
      if (free !== null && free < 22 * 1024 ** 3) {
        log('磁盘可用空间只有 ' + Math.round(free / 1024 ** 3) + 'GB，整合包 8GB + 解压后 14GB，空间不够会装不完。')
      }
      archive = path.join(dir, 'gpt-sovits-pack.7z')
      let lastErr = null
      for (const src of SOURCES) {
        if (signal.aborted) throw new Error('已取消')
        setJob({ source: src.label, bytes: 0, total: 0, percent: null })
        log('从 ' + src.label + ' 下载整合包（约 8GB，慢网要一两个小时）……')
        try {
          await downloadTo(src.url, archive, (seen, total) => {
            setJob({
              bytes: seen,
              total,
              percent: total ? Math.round((seen / total) * 100) : null,
              message: '下载中 ' + (seen / 1024 ** 2).toFixed(0) + 'MB' + (total ? ' / ' + (total / 1024 ** 2).toFixed(0) + 'MB' : ''),
            })
          }, signal)
          lastErr = null
          break
        } catch (err) {
          if (signal.aborted) throw err
          lastErr = err
          log(src.label + ' 失败（' + String((err && err.message) || err).slice(0, 60) + '），换下一个源')
        }
      }
      if (lastErr) throw lastErr

      setJob({ phase: 'extracting', percent: null })
      log('解压中（这一步很慢，几分钟到十几分钟）……')
      const exe = await ensure7z(log)
      await run7z(exe, ['x', archive, '-o' + dir, '-y', '-bso0', '-bsp0'], null)
      if (signal.aborted) throw new Error('已取消')

      const root = await locateRoot(dir)
      if (!root) throw new Error('解压完了但没找到 api_v2.py，目录结构可能不对：' + dir)
      const launcher = await writeLauncher(root)
      setJob({ phase: 'done', state: 'done', percent: 100, finishedAt: now(), message: '装好了：' + root + '（启动脚本 ' + launcher + '）' })
      try { await fsp.unlink(archive) } catch (e) {}
    } catch (err) {
      const msg = String((err && err.message) || err).slice(0, 300)
      setJob({
        state: signal.aborted ? 'cancelled' : 'error',
        phase: signal.aborted ? 'cancelled' : 'error',
        error: msg,
        message: signal.aborted ? '已取消' : '失败：' + msg,
        finishedAt: now(),
      })
    } finally {
      controller = null
    }
  })()

  return { ok: true, dir, job: { ...job } }
}

export function cancel() {
  if (controller) {
    try { controller.abort() } catch (e) {}
    return { ok: true, cancelled: true }
  }
  return { ok: true, cancelled: false }
}

export async function start(rootOverride) {
  const root = rootOverride || (await locateRoot(job.dir || defaultDir()))
  if (!root) return { ok: false, error: '还没装好，找不到 api_v2.py' }
  const running = await apiRunning()
  if (running.running) return { ok: true, already: true, api: running }
  const launcher = path.join(root, 'start-tts-api.bat')
  const bat = fs.existsSync(launcher) ? launcher : await writeLauncher(root)
  // 用 WMI 派生，父进程不是我们的作业对象，DSH 重启也不会被一并回收
  const psBat = bat.replace(/'/g, "''")
  const ps = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$bat = '" + psBat + "'",
    "$cmd = 'cmd.exe /c \"' + $bat + '\"'",
    '$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }',
    'Write-Output ("pid=" + $r.ProcessId)',
  ].join('\r\n')
  const tmp = path.join(TMP, 'start-gpt-api.ps1')
  await fsp.mkdir(TMP, { recursive: true })
  await fsp.writeFile(tmp, ps, 'utf8')
  const out = await new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp], { windowsHide: true })
    let buf = ''
    child.stdout.on('data', (d) => { buf += String(d) })
    child.stderr.on('data', (d) => { buf += String(d) })
    child.on('close', () => resolve(buf.trim()))
    child.on('error', (err) => resolve('error: ' + String((err && err.message) || err)))
  })
  return { ok: true, launched: true, launcher: bat, output: out.slice(0, 300) }
}
