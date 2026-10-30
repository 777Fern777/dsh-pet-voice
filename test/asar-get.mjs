// 从 app.asar 里按路径提取文件内容（asar：16 字节头 + JSON 索引 + 数据区）
import fs from 'node:fs'

const asar = process.argv[2]
const wanted = process.argv.slice(3)

const fd = fs.openSync(asar, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(12)
const jsonBuf = Buffer.alloc(headerSize)
fs.readSync(fd, jsonBuf, 0, headerSize, 16)
const index = JSON.parse(jsonBuf.toString('utf8'))
const dataStart = 16 + headerSize

function find(p) {
  let node = index
  for (const seg of p.split('/').filter(Boolean)) {
    if (!node.files || !node.files[seg]) return null
    node = node.files[seg]
  }
  return node.files ? null : node
}

for (const w of wanted) {
  const entry = find(w)
  if (!entry) { console.log('=== ' + w + ' : 未找到 ==='); continue }
  const buf = Buffer.alloc(Number(entry.size))
  fs.readSync(fd, buf, 0, buf.length, dataStart + Number(entry.offset))
  console.log('===== ' + w + ' (' + buf.length + 'B) =====')
  console.log(buf.toString('utf8'))
}
fs.closeSync(fd)
