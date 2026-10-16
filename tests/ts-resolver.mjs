/**
 * Node ESM loader hook：为无扩展名的相对导入补齐 .ts 扩展名。
 * src 下的 TS 源码沿用前端写法（import x from "./y"），Node ESM 默认解析不到，
 * 通过该 hook 让测试可以直接加载真实源码，而不是拷贝副本。
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = /^\.{1,2}\//.test(specifier)
  const hasExt = /\.[cm]?[jt]sx?$/.test(specifier)

  if (isRelative && !hasExt) {
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
      try {
        return await nextResolve(specifier + ext, context)
      } catch {
        // 继续尝试下一个扩展名
      }
    }
  }
  return nextResolve(specifier, context)
}
