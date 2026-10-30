import * as gpt from '../gpt-installer.js'
console.log('exports', Object.keys(gpt).join(','))
console.log('defaultDir', gpt.defaultDir())
console.log('apiRunning', await gpt.apiRunning())
const st = await gpt.status()
console.log('status', JSON.stringify(st))
