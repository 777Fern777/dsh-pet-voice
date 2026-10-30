// 扫 app.asar 里的路径（读头部 JSON 索引），用于找官方语音相关包
import fs from 'node:fs'

const file = process.argv[2]
const needle = (process.argv[3] || '').toLowerCase()
const fd = fs.readFileSync(file)
const size = fd.readUInt32LE(12)
const json = JSON.parse(fd.subarray(16, 16 + size).toString('utf8'))
const hits = []
function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (val.files) walk(val, p)
    else if (!needle || p.toLowerCase().includes(needle)) hits.push(p + '  (' + (val.size || 0) + 'B)')
  }
}
walk(json, '')
console.log('命中 ' + hits.length + ' 条：')
for (const h of hits.slice(0, Number(process.argv[4] || 60))) console.log('  ' + h)
