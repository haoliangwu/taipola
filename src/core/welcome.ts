/**
 * The document a first-time visitor lands in, and the name it answers to.
 *
 * The two travel together on purpose: the title bar shows this name, the save
 * picker suggests it and an export is named after it. Spelling it out at each of
 * those places is how the title bar ended up saying one thing while the save
 * dialog said `untitled.md`.
 */
export const WELCOME_NAME = 'welcome.md'

export const WELCOME_DOC = `# 你好呀，我是 taipola

我是住在你浏览器里的一个极简 Markdown 编辑器。

![taipola 的头像](https://raw.githubusercontent.com/haoliangwu/taipola/main/docs/logo.webp){width=128}

**光标停在哪一段，我就把那一段的 Markdown 源码摊开给你看；光标一走开，我马上把它变回好看的样子。**

没有左右分栏，也没有"预览"按钮 —— 我一直觉得，写字的时候不该在心里默默换算两遍。

你可以用方向键上下走走看，我就当着你的面变来变去。

## 我会些什么

- **即时渲染**：段落、标题、列表、引用、代码块、表格，我都就地帮你变
- **中文输入法友好**：我不抢你的拼音候选，也不打断联想词，你合成的时候我安安静静不吭声
- **自带撤销栈**：\`Cmd/Ctrl + Z\` / \`Cmd/Ctrl + Shift + Z\` 走的是我自己的快照栈，跨块也靠得住（浏览器自带的那个，跨块就有点不听话）
- **打开 / 保存**：\`Cmd/Ctrl + O\` 打开 md 文件，\`Cmd/Ctrl + S\` 保存 —— 浏览器要是允许，我就直接写回原文件
- **侧边大纲**：点一下标题，我就跳过去
- **自动保存草稿**：你手滑关掉页面，我也还记得你写到哪儿了

## 行内样式

**粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)，还有脚注[^1]，这些我都认得。

[^1]: 像我这样的小小补充，在屏幕上就留在原地，导出成 HTML 的时候才会被挪到文末去。

## 标题分级

# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

## 无序列表

- 用 \`-\`、\`*\` 或 \`+\` 开头，在我眼里都是一项
- 光标一离开这个块，符号就缩成一个小圆点
- 缩进两个空格，就是我收下的子项

## 有序列表

1. 打开 / 保存
2. 大纲跳转
3. 主题切换

## 列表嵌套

- 第一层列表项
  - 缩进两个空格的子项
  - 另一个子项
    1. 嵌套的有序列表
    2. 继续编号
- 回到第一层

## 引用

> 写作是把思绪压进纸张的过程。
> —— 某个已经想不起来的人

> 嵌套引用我也照收：
> > 被引用的引用，照样好好渲染。

## 任务列表

- [x] 做一个即时渲染的编辑器
- [ ] 圆角、阴影、暗色主题
- [ ] 数学公式与图表

## 代码高亮

\`\`\`typescript
interface Block {
  startLine: number
  raw: string
  html: string
}

export function activeBlock(blocks: Block[], caret: number): Block | undefined {
  return blocks.find((b) => caret >= b.start && caret < b.end)
}
\`\`\`

没写语言的围栏，我也照收：

\`\`\`
echo "hello, taipola"
\`\`\`

## 表格

| 快捷键 | 作用 |
| --- | --- |
| \`Cmd/Ctrl + B\` | 加粗选中文字 |
| \`Cmd/Ctrl + I\` | 斜体 |
| \`Cmd/Ctrl + K\` | 插入链接 |
| \`Cmd/Ctrl + E\` | 行内代码 |
| \`Cmd/Ctrl + 1..6\` | 切换标题级别 |
| \`Cmd/Ctrl + Shift + K\` | 删除整行 |

## 图片与链接

![示例图片](https://pic1.zhimg.com/v2-11005a90e751b84eb1e2a0bb33c1c142_l.jpg?source=32738c0c&needBackground=1)

你随手打出来的网址我也认：https://example.com 就像这样，夹在句子里的 https://example.net 也跑不掉。

## 分割线

三个短横线就是一条水平线：

---

好啦，接下来就交给你了。这篇可以直接删掉，也可以干脆改成你自己的第一句话。
`
