// 注册 TS 解析 hook（配合 --import ./tests/_register.mjs 使用）
import { register } from 'node:module'

register('./ts-resolver.mjs', import.meta.url)
