// 读 app.asar 的头部索引，找 sherpa-onnx / 语音相关文件（asar 头是 JSON，前面 16 字节）
import fs from 'node:fs'

const file = process.argv[2]
const fd = fs.openSync(file, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const size = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(size)
fs.readSync(fd, jsonBuf, 0, size, 16)
const json = JSON.parse(jsonBuf.toString('utf8'))
fs.closeSync(fd)

const needle = (process.argv[3] || 'sherpa').toLowerCase()
const hits = []
function walk(node, prefix) {
  for (const [name, val] of Object.entries(node.files || {})) {
    const p = prefix + '/' + name
    if (val.files) walk(val, p)
    else if (p.toLowerCase().includes(needle)) hits.push(p + '  (' + (val.size || 0) + 'B)')
  }
}
walk(json, '')
console.log('命中 ' + hits.length + ' 条：')
for (const h of hits.slice(0, 40)) console.log('  ' + h)
