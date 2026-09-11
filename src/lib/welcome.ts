export const WELCOME_DOC = `# 欢迎使用 taipola

一个极简但强大的 Markdown 编辑器。**光标所在的那一行显示 Markdown 源码，光标一离开就渲染成最终的样子** —— 没有左右分栏，也不需要预览按钮。

试试用方向键上下移动光标，看这段文字在你眼前变形。

## 它现在能做什么

- **即时渲染**：段落、标题、列表、引用、代码块、表格全部就地渲染
- **中文输入法友好**：沿用原生输入框，拼音候选、联想词都正常
- **原生撤销栈**：\`Cmd/Ctrl + Z\` 是浏览器原生的撤销，快且可靠
- **打开 / 保存**：\`Cmd/Ctrl + O\` 打开 md 文件，\`Cmd/Ctrl + S\` 保存（支持就写回原文件）
- **侧边大纲**：点击标题跳转
- **自动保存草稿**：关掉页面也不丢内容

## 行内样式

**粗体**、*斜体*、~~删除线~~、\`行内代码\`、[链接](https://example.com)、脚注[^1]。

[^1]: 脚注也会被渲染出来。

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

## 表格

| 快捷键 | 作用 |
| --- | --- |
| \`Cmd/Ctrl + B\` | 加粗选中文字 |
| \`Cmd/Ctrl + I\` | 斜体 |
| \`Cmd/Ctrl + K\` | 插入链接 |
| \`Cmd/Ctrl + E\` | 行内代码 |
| \`Cmd/Ctrl + 1..6\` | 切换标题级别 |
| \`Cmd/Ctrl + Shift + K\` | 删除整行 |

## 引用与任务列表

> 写作是把思绪压进纸张的过程。
> —— 某个已经想不起来的人

- [x] 做一个即时渲染的编辑器
- [ ] 圆角、阴影、暗色主题
- [ ] 数学公式与图表

---

就这样，开始写你的东西吧。删掉这篇，或者直接覆盖它。
`
