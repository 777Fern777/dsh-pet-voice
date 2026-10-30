// 端到端演练「一键装 GPT-SoVITS」：用 7zr 打一个假整合包，本地 HTTP 服出去，
// 让 gpt-installer 走完 下载 → 解压 → 找根目录 → 写启动脚本 的全流程。
// 不联网、不占大空间，几秒跑完。
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const TMP = path.join(os.tmpdir(), 'dsh-pet-voice')
const WORK = path.join(os.tmpdir(), 'dshpet-gpt-test')
const PACK_SRC = path.join(WORK, 'src', 'GPT-SoVITS-fake')
const ARCHIVE = path.join(WORK, 'fake-pack.7z')
const INSTALL_DIR = path.join(WORK, 'install')

function find7zr() {
  const c = path.join(TMP, '7zr.exe')
  return fs.existsSync(c) ? c : null
}

const sevenZip = find7zr()
if (!sevenZip) {
  console.log('跳过：没有 7zr.exe（安装流程里会自动下载它，这里不重复下）')
  process.exit(0)
}

// ① 造一个假的整合包目录结构
await fsp.rm(WORK, { recursive: true, force: true })
await fsp.mkdir(path.join(PACK_SRC, 'GPT_SoVITS', 'configs'), { recursive: true })
await fsp.mkdir(path.join(PACK_SRC, 'runtime'), { recursive: true })
await fsp.writeFile(path.join(PACK_SRC, 'api_v2.py'), '# fake api\n')
await fsp.writeFile(path.join(PACK_SRC, 'GPT_SoVITS', 'configs', 'tts_infer.yaml'), 'device: cpu\n')
await fsp.writeFile(path.join(PACK_SRC, 'runtime', 'python.exe'), 'fake')

const packed = spawnSync(sevenZip, ['a', ARCHIVE, '.'], { cwd: PACK_SRC, encoding: 'utf8' })
assert.equal(packed.status, 0, '打包失败：' + packed.stderr)
const archiveBytes = (await fsp.stat(ARCHIVE)).size
assert.ok(archiveBytes > 0, '压缩包是空的')

// ② 本地 HTTP 把它服出去
const server = http.createServer(async (req, res) => {
  if (req.url !== '/pack.7z') { res.writeHead(404).end('nope'); return }
  const buf = await fsp.readFile(ARCHIVE)
  res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', 'Content-Length': buf.length })
  res.end(buf)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
process.env.DSH_PET_GPT_URL = 'http://127.0.0.1:' + port + '/pack.7z'
process.env.DSH_PET_GPT_DIR = INSTALL_DIR

const gpt = await import('../gpt-installer.js')
const start = Date.now()
const first = await gpt.install('')
assert.equal(first.ok, true, 'install 应该受理：' + JSON.stringify(first))

// 等任务结束（假包很小，几秒内）
let st = null
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 250))
  st = await gpt.status()
  if (st.job.state !== 'running') break
}
const secs = ((Date.now() - start) / 1000).toFixed(1)
console.log('job:', st.job.state, st.job.phase, '耗时', secs + 's')
assert.equal(st.job.state, 'done', '任务应完成，实际 ' + st.job.state + ' / ' + st.job.error)

// ③ 解压结果检查：根目录找到、启动脚本写好、压缩包删掉
assert.equal(st.installed, true, '应识别为已安装')
assert.ok(st.root && fs.existsSync(path.join(st.root, 'api_v2.py')), '根目录里应有 api_v2.py：' + st.root)
assert.ok(st.launcher && fs.existsSync(st.launcher), '应写启动脚本：' + st.launcher)
const launcher = await fsp.readFile(st.launcher, 'utf8')
assert.ok(launcher.includes('api_v2.py'), '启动脚本要跑 api_v2.py')
assert.ok(launcher.includes('9880'), '启动脚本要用 9880 端口')
assert.equal(fs.existsSync(path.join(st.dir, 'gpt-sovits-pack.7z')), false, '装完应删掉压缩包')
console.log('root:', st.root)
console.log('launcher:', st.launcher.split('\n').filter(Boolean).join(' | '))

// ④ 重复点不该重开一份
const again = await gpt.install('')
assert.equal(again.ok, true)
console.log('重复安装返回:', JSON.stringify(again).slice(0, 120))

server.close()
console.log('\n✅ 一键安装流程演练通过')
