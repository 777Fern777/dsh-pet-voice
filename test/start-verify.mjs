import * as gpt from '../gpt-installer.js'
const r = await gpt.start()
console.log('start =>', JSON.stringify(r))
for (let i = 0; i < 24; i++) {
  await new Promise((s) => setTimeout(s, 5000))
  const a = await gpt.apiRunning()
  console.log(i * 5 + 5 + 's', a.running ? 'UP status=' + a.status : 'down')
  if (a.running) break
}
