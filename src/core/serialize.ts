/**
 * 盒模型迁移第 1 步：从块树序列化回源码（`.scratch/block-model/…`）。
 *
 * 每个块节点的 `raw` 是它在源里的逐字符切片（`parseDocument` 的平铺不变量，
 * 其 DEV 断言保证无字符丢失/重复），只是末尾换行被裁掉——那是内核编辑缓冲的
 * 语义（`kernel.ts` 的块编辑 = raw 替换）。所以序列化要做的唯一一件事是按行
 * 跨度把换行数补回来：块的行数 `endLine - startLine` 是块自己携带的，空白块
 * （raw 只有个位数空格甚至 ''）正是靠它区分"一个空行"还是"两个空行"。
 *
 * 与 Typora `toMark` 的差别只剩一步：这里写回的是原切片，将来由命令层改为
 * 模板化重建（`toMark` 风格）；本文件把"序列化"这条腿立住、测死。
 */
import type { BlockTree } from './blockTree'
import { parseBlockTree } from './blockTree'

/**
 * Serializes a block tree back to source text — byte-identical to the input
 * that produced it.
 *
 * Blocks sit in the source exactly one after the other, so the join between
 * blocks is a single newline. Inside a block, `raw` already carries all its
 * lines joined by newlines; the only thing the slice lost is the newlines that
 * TERMINATED the block's last line — and a chunk of them belongs to a blank
 * block whose lines are all empty (`raw` is then `''` regardless of how many
 * blank lines the span covers). Repeating the missing count restores both.
 */
export function serializeBlocks(tree: BlockTree): string {
  return tree.blocks
    .map((block) => {
      const missingNewlines = block.endLine - block.startLine - block.raw.split('\n').length
      return missingNewlines > 0 ? block.raw + '\n'.repeat(missingNewlines) : block.raw
    })
    .join('\n')
}

/** The inverse-direction guarantee, as a predicate: what a tree serializes to
    parses back into an identical tree. */
export function roundTripInvariant(source: string): boolean {
  const tree = parseBlockTree(source)
  const restored = parseBlockTree(serializeBlocks(tree))
  return (
    tree.blocks.length === restored.blocks.length &&
    tree.blocks.every(
      (block, i) =>
        block.kind === restored.blocks[i]?.kind &&
        block.raw === restored.blocks[i]?.raw &&
        block.headingLevel === restored.blocks[i]?.headingLevel &&
        block.startLine === restored.blocks[i]?.startLine &&
        block.endLine === restored.blocks[i]?.endLine,
    )
  )
}