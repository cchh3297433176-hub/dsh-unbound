# 教训：0.1.0 为什么会让**每一轮对话**在 0.1 秒内失败

这份文档写给下一个改这个仓库的 AI（也写给我自己）。如果你正在读它，先读完再动代码。

## 事故现象

0.1.0 装进 DSH 之后，**任何一条消息都会立刻失败**，用户看到的是：

```
UNKNOWN format v4 message requires a producer-owned source kind
```

每一轮耗时 < 0.1 秒——根本没走到模型，是本地在**写会话日志**时就被拒了。

## 错在哪

0.1.0 想在每一轮给模型加一段“成人对话契约”，用的手法是**往会话里插一条伪造的 user 消息**：

```js
// ❌ 0.1.0 的写法：错的
ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
  const decision = await next()
  return {
    kind: 'enter',
    messages: [...decision.messages, createUserMessage({
      content: [{ type: 'text', text: prompt }],
      source: { kind: 'plugin', plugin: 'unbound', form: 'instructions' }, // ← 这就是雷
    })],
  }
})
```

`source.kind = 'plugin'` 是**已下线的历史写法**。v4 会话格式的准入校验（`@deepseek-ai/dsh-session-format-v3-to-v4` 的 `message-sources`）只接受**由生产者自己拥有的 kind**，见到 `'plugin'` 直接抛错；而这条消息每次都要落盘，于是**每一轮都在落盘前炸掉**。

注意它连“降级成普通消息”都没有——不是不生效，是**整个会话不可用**。

## 正确做法：用 prompt section，不要碰会话日志

常驻的行为规则，注册成**系统提示的一个 section**：

```js
// ✅ 0.2.x 的写法
export const inject = ['systemPrompt', 'tools']

export function apply(ctx, config = {}) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'unbound:contract',
    order: 650,              // 行为策略区：plan 500 / team 600 之后、工具说明之前
    interpolate: false,      // 文本里的 {{...}} 不要被当变量插值
    text: () => currentPrompt(),   // 每次组装都会重新求值 → 开关立刻生效
  }), 'unbound.contract')
}
```

要点：

1. **`text` 用函数**，不要用常量：状态（开/关、当前文风）变了，下一步组装就变，不需要重启；
2. **不要设 `complete: true`**：那会顶掉 DSH 整套系统提示；
3. **永远不要**为了“加指令”而 `createUserMessage` / `agent.inbox` / `steer`——会话日志是**审计与回放**用的，不是插件塞私货的地方；
4. 需要持久状态就写自己的文件（本仓库用 `$DSH_HOME/unbound/state.json`），不要写进会话。

## 给下一个 AI 的检查清单

写/改 DSH 插件时：

- [ ] **先读安装包里真实的 API**（`node_modules/@deepseek-ai/*/lib/*.js` 或 `*.d.ts`），不要凭记忆写字段名；
- [ ] 要“给模型加规则”→ `ctx.systemPrompt.section`；要“换模型能力”→ `ctx.tools.register`；要“做人机交互”→ dsh-go 插件；
- [ ] 任何 `source: { kind: ... }` 都不要自己造 `'plugin'`；
- [ ] 插件**不允许把整个会话搞挂**：失败要退化成“功能不生效”，不是“消息发不出”；
- [ ] `node --test` 必须全绿；再**在自己（或真机）环境里装一遍**，确认“发一条消息能正常回”；
- [ ] 版本号要递增，写清 `CHANGELOG`/提交信息，别让用户用“同一个 git 地址”反复踩同一个坑。

## 一条经验总结

> 在 DSH 里，**“改提示词”和“写会话”是两件事**。
> 提示词走 prompt 注册表（section / context / variable）；
> 会话日志只有 Agent 自己和用户能写。
> 混淆这两者，就会得到一个“看起来只是加了段话、实际上每轮必挂”的插件。
