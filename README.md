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

## 两部分内容

| | 位置 | 谁改 |
| --- | --- | --- |
| 互动许可（合同） | 代码里的 `prompts.js` → `CORE_PROMPT` | 不建议改 |
| 文风库 | `$DSH_HOME/unbound/styles/*.md` | 你，随时 |
| 开关状态 | `$DSH_HOME/unbound/state.json` | 工具或手机面板 |

`styles/` 里一套文风一个文件，首行 `# 名字` 是标题，后面整段就是提示词。第一次运行会种子文件 `anti-cliche.md`（原来的防八股规则）。

## 工具

- `get_unbound_status`：模式开没开、当前哪套文风。
- `list_unbound_styles`：列出文风库并标出使用中的那套。
- `set_unbound_mode`：开/关成人模式，或切到某套文风（传空串 = 不用文风）。
- `save_unbound_style`：把一段提示词存成文风文件并立刻启用。

手机上的 `local-unbound` 插件提供同名面板「文风与模式」：在聊天页「插件」弹层和「全部功能」里，点一行就能切，不占输入框胶囊。

## 配置（`cordis.patch.yml`）

| 配置 | 默认值 | 作用 |
| --- | --- | --- |
| `enabled` | `true` | 首次运行时是否开启成人对话模式 |
| `antiCliche` | `true` | 旧配置项；首次运行时决定是否默认用 `anti-cliche` 文风 |
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
