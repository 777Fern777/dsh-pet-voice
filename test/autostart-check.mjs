// 自启动开关演练：造一个假安装目录 → 打开/关闭开机自启 → 检查 Startup 里的 vbs
import assert from 'node:assert'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const WORK = path.join(os.tmpdir(), 'dshpet-auto-test')
const FAKE_ROOT = path.join(WORK, 'GPT-SoVITS')
const STATE_FILE = path.join(os.homedir(), '.dsh-pet-voice', 'state.json')

// 备份用户真实状态，测完还原
let backup = null
try { backup = await fsp.readFile(STATE_FILE, 'utf8') } catch (e) {}

await fsp.rm(WORK, { recursive: true, force: true })
await fsp.mkdir(path.join(FAKE_ROOT, 'GPT_SoVITS', 'configs'), { recursive: true })
await fsp.mkdir(path.join(FAKE_ROOT, 'runtime'), { recursive: true })
await fsp.writeFile(path.join(FAKE_ROOT, 'api_v2.py'), '# fake\n')
await fsp.writeFile(path.join(FAKE_ROOT, 'runtime', 'python.exe'), 'fake')

process.env.DSH_PET_GPT_DIR = FAKE_ROOT
const gpt = await import('../gpt-installer.js')

const vbsPath = () => path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'dsh-pet-gpt.vbs')

let st = await gpt.autostartStatus()
console.log('初始:', JSON.stringify({ bootOnLogin: st.bootOnLogin, bootWithDsh: st.bootWithDsh }))

st = await gpt.setAutoStart({ bootOnLogin: true })
assert.equal(st.bootOnLogin, true, '应该打开开机自启')
assert.equal(st.loginRegistered, true, 'vbs 应该写进 Startup')
const vbs = await fsp.readFile(vbsPath(), 'utf8')
assert.ok(vbs.includes('start-tts-api.bat'), 'vbs 要指向启动脚本')
assert.ok(vbs.includes('sh.Run'), 'vbs 要用 Run 隐藏启动')
console.log('vbs:\n' + vbs.trim())

st = await gpt.setAutoStart({ bootOnLogin: false })
assert.equal(st.loginRegistered, false, '关掉后 vbs 应删掉')
assert.equal(fs.existsSync(vbsPath()), false)

st = await gpt.setAutoStart({ bootWithDsh: false })
assert.equal(st.bootWithDsh, false)
st = await gpt.setAutoStart({ bootWithDsh: true })
assert.equal(st.bootWithDsh, true)
console.log('随 DSH 拉起开关来回切：正常')

// 清理：删测试目录、还原用户状态、确保不留 vbs
try { await fsp.unlink(vbsPath()) } catch (e) {}
await fsp.rm(WORK, { recursive: true, force: true })
if (backup !== null) {
  await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true })
  await fsp.writeFile(STATE_FILE, backup, 'utf8')
}
console.log('\n✅ 自启动开关演练通过')
