/**
 * 精简 Cordis 启动器：只装配 examples/cordis.yml 里列出的插件，
 * 不启动完整 DSH。用于在没有模型、没有 API key 的情况下迭代插件代码。
 * 与官方启动器的差别：官方 boot 走 profile 的裸模块解析，这里的精简环境
 * 用 createRequire 把裸包名解析成绝对路径。
 */
import { Context } from '@deepseek-ai/cordis'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import Loader, { EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'

const ROOT = resolve(import.meta.dirname, '..')
const configPath = resolve(process.argv[2] ?? resolve(import.meta.dirname, 'cordis.yml'))
const require = createRequire(pathToFileURL(resolve(ROOT, 'package.json')))

const ctx = new Context()
ctx.baseUrl = pathToFileURL(dirname(configPath)).href + '/'

// 把插件加载期抛出的错误打出来：默认 logger 没有 console 输出端，会静默吞掉。
ctx.on('internal/update', (_config, _noSave, next) => {
  Promise.resolve(next()).catch((error) => console.error('[loader error]', error))
}, { global: true, prepend: true })

await ctx.plugin(Loader)

// 让裸包名（@deepseek-ai/*）解析到本目录 node_modules 里链接的真实包入口。
ctx.loader.builtins.include = class LocalResolveInclude extends Include {
  import(name, getOuterStack) {
    if (name.startsWith('.') || isAbsolute(name) || name.startsWith('cordis:')) {
      return super.import(name, getOuterStack)
    }
    return super.import(pathToFileURL(require.resolve(name)).href, getOuterStack)
  }
}
ctx.loader.builtins.group = EntryGroup

await ctx.loader.create({
  id: 'include',
  name: 'cordis:include',
  config: { path: pathToFileURL(configPath).href },
})
await ctx.get('loader')?.await()
await new Promise((done) => setTimeout(done, 500))

// 启动审计：条目加载失败或依赖始终没就绪时，这里能看出来。
let bad = 0
for (const entry of ctx.loader.entries()) {
  if (entry.fiber) continue
  bad += 1
  console.error(`[launch] 未激活：${entry.options.name}（加载失败或依赖未就绪）`)
}
if (bad > 0) process.exitCode = 1
