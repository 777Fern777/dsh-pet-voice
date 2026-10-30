// 从 index.js 里把所有 /dsh-pet/* 路由常量抠出来，供 README 使用。
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
const paths = src.match(/\/dsh-pet\/[A-Za-z0-9_/.-]*/g) || []
const uniq = [...new Set(paths)].sort()
console.log('路由：')
for (const p of uniq) console.log('  ' + p)
console.log('总数：', uniq.length)
