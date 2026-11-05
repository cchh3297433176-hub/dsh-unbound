# dsh-unbound

给 DeepSeek Harness 增加可开关的“成年人直接交流”模式，并把“说话方式”拆成可编辑的文风库。

## 特点

- 默认开启成人对话模式，保持已经开始的互动连续。
- 文风与互动许可是两件事：许可固定，文风是文件，随便换、随便存。
- 不绑定角色卡、小说家身份或固定 RP 人设。
- 普通问答、编程与工具任务继续按原任务处理。
- 所有开关和文风都写在磁盘上，改完即时生效，重启也记得。

## 安装

```sh
dsh plugin --profile <profile> add github:cchh3297433176-hub/dsh-unbound
```

装上即生效；改 `lib/` 以外的代码不需要重启引擎。

## 三层提示词（0.3.0 起）

三层互不覆盖，各占一个槽位，可以只开其中任意几层：

| 槽位 | 管什么 | 默认 | 位置 |
| --- | --- | --- | --- |
| `base` | 防八股：写作卫生，永远在 | `anti-cliche` | `$DSH_HOME/unbound/styles/anti-cliche.md` |
| `persona` | 角色扮演的人设：谁在说话 | 空 | 同目录任意 `.md` |
| `style` | 文风：句子怎么走、用词什么调 | 空 | 同目录任意 `.md` |
| 互动许可（合同） | 许可与硬边界，代码里的 `CORE_PROMPT` | 固定 | 不建议改 |
| 开关状态 | 三个槽位各指向哪个文件 | — | `$DSH_HOME/unbound/state.json` |

拼装顺序是 合同 → 防八股 → `<persona>` → `<writing_style>` → 附加要求。0.2.0 的 `{ style }` 状态会自动迁移：`anti-cliche` 进 `base`，其他 id 留在 `style`。

`styles/` 里一个文件就是一段提示词，首行 `# 名字` 是标题，后面整段生效。同一个文件可以被任一槽位引用，槽位决定它按哪一层拼进去。

## 工具

- `get_unbound_status`：模式开没开，三个槽位各是哪份文件。
- `list_unbound_styles`：列出库里的文件，并标出被 base / persona / style 占用的那几个。
- `set_unbound_mode`：开/关成人模式；`base` / `persona` / `style` 分别换文件（空串 = 清掉该层）。
- `save_unbound_style`：存一份提示词进库，`slot` 指定它进哪一层（默认 `style`）。

手机上的 `local-unbound` 插件提供同名面板「文风与模式」：在聊天页「插件」弹层和「全部功能」里，点一行就能切，不占输入框胶囊。

## 配置（`cordis.patch.yml`）

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 首次运行时是否开启成人对话模式 |
| `antiCliche` | `true` | 旧配置项；没有 state 时决定 `base` 层默认开不开 |
| `extraInstructions` | 空 | 追加在最后的附加要求 |

## 测试

```sh
node --test
```

> 历史事故与正确写法见 [LESSONS.md](./LESSONS.md)：0.1.0 曾经让每一轮对话秒挂，别重复。

## 实现要点

规则注册为一条 system prompt section（`unbound:contract`，order 650，排在行为策略区），文本在每次组装提示词时按当前状态重新生成。**不往会话里写任何消息**：v4 会话格式只接受由生产者自己拥有的 source kind，`{kind:'plugin'}` 会被拒（`format v4 message requires a producer-owned source kind`）——0.1.0 正是这么写的，装上去后每一轮对话都会在 0.1 秒内失败。

状态与文风文件的读取按 mtime+size 缓存，所以每个 step 只多花一次 `stat`，改了文件下一步就生效。插件只 import `node:` 内置模块，挂载在任何位置都能解析依赖。

## 提示词设计

核心规则参考并重新整理了用户提供的 DeepSeek 特化预设：

- `simple_V2.0_1022`：头部任务约束、持续响应与防八股思路。
- `极简预设_A1.6`：短提示下的核心行为固定方式。
- `茉莉文集 for DeepSeek v4 2.0`：持续创作任务和上下文承接方式。
- `Ako 1.92`：作为 Gemini 预设，仅用于比较跨模型通用结构。

本仓库没有复制这些预设的完整提示词、角色身份、文风模块、字数锁或思维链内容。

## 范围

模式面向所有参与者均为成年人的自愿互动。它不会把未成年人、缺乏同意或现实伤害包装成成人自愿情境。

## License

MIT
