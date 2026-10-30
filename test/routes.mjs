// 从 index.js 里把所有 /dsh-pet/* 路由常量抠出来，供 README 使用。
// 只看代码行（跳过注释），并且只要带扩展名或第二段之后的具体路由。
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const paths = []
for (const line of src.split(/\r?\n/)) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
  for (const m of line.matchAll(/\/dsh-pet\/[A-Za-z0-9_/.+-]*/g)) paths.push(m[0])
}
const uniq = [...new Set(paths)].filter((p) => p !== '/dsh-pet/' && p !== '/dsh-pet/gpt/').sort()
console.log('路由：')
for (const p of uniq) console.log('  ' + p)
console.log('总数：', uniq.length)
