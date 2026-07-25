# Dynamic Rest Task Voice and Variety Design

## 目标

调整 Contract 1.1 Dynamic Rest Agent，让它生成具体、有生活感、愿意立即去做的
休息任务，并明显减少通用 AI 陪伴腔。

本次设计覆盖：

- Mode A `work_state_or_rest_decision` 的休息判断、前置文案和动态任务；
- Mode B `manual_rest_quest` 的前置文案和动态任务；
- 服务端受控随机策略；
- Dynamic Rest 在 Apple 客户端中的文案呈现；
- Prompt 与真实模型输出的评测方法。

本次不改变 Contract 1.1 的服务端控制边界。模型仍只生成 `message`、
`shouldOfferRest`、`reasonCode` 和 `generatedTask` 中已有的字段，不控制通知、
Shield、Lockdown、checkpoint、页面跳转、邮件或消息。

## 当前基线

提交 `8e5c5d9` 已向 Mode A Prompt 增加真实性、非诊断、非绩效和短句要求。这些规则
继续保留，但它还没有解决本设计的任务多样性和生活化表达：

- Mode A 仍要求笼统的 `calm` introduction 和桌边任务；
- Mode B 仍使用独立的旧 Prompt，没有新的产品语言规则；
- Mode B 的说明被写进 Mode A Prompt，实际 Mode B 调用不会读取这些文字；
- 没有 task brief、任务类别选择或可测试随机源；
- 动态输出仍只做结构类型校验，没有时长、非空内容和补充数量限制；
- Apple 客户端仍把动态补充显示成编号步骤。

实现应在这份最新基线上增量修改，不回退该提交中的适用安全规则。

## 产品语言

Hush 不扮演治疗师、健康教练或拟人化陪伴者。它像熟人注意到用户还没有停，
随口说一句，再递来一个离开屏幕的理由。

文案遵循以下原则：

1. 不安慰、不鼓励坚持、不解释休息的好处。
2. 优先写具体物体、地点和动作，例如杯子、叶子、窗户、椅子、水、风和歌。
3. 能用一个动作说清楚时，不使用抽象状态描述。
4. 允许短句、省略主语和轻微口语，不追求完整、圆润的客服句式。
5. 不自称“我在这里陪你”，不把 Hush 写成需要用户回应的角色。
6. 不使用感叹号，不使用医疗、治疗、效率或绩效语言。

Prompt 应避免把以下词当作气氛填充：

```text
此刻、当下、空间、节奏、状态、能量、疗愈、觉察、允许自己、
照顾自己、陪伴、重新连接、找回、温柔地、慢慢地、正合适、
给自己一个……
```

这些词不是机械的逐字黑名单。当“慢慢抬腿”等词直接描述动作速度时仍可使用；
但不得用它们代替具体内容。

## 前置接话

`message` 是任务前的一句口语，不是任务说明，也不是第二轮问答。它可以随机采用：

- 轻问：`累了吧？`
- 观察：`坐挺久了。`
- 轻微打趣：`还没累？眼睛倒是看够久了。`
- 极简收尾：`这一段到这儿。`

轻问句不等待用户回答，任务紧接着出现。它不得询问“要不要休息”，因为客户端
已经准备呈现任务。

Mode A 最多自然使用一个真实信号。估算的连续时长不得写成精确分钟；无法确认
用户在浏览内容时只能说“看屏幕”，不能说“刷手机”。只有用户提供的标签明确
表达刷手机或社交媒体时，才可使用相应说法。

Mode B 中用户已经主动选择休息。`message` 不分析工作数据，不判断用户是否“配得
上”休息，只使用 `好。`、`走，换个地方。` 等简短接话。

禁止带有责备或健康施压的句式，例如：

```text
你已经工作这么久了，难道还不累吗？
为了身体健康，请立即停止使用设备。
你需要倾听身体发出的信号。
```

## 任务结构

`generatedTask` 保持现有结构：

```json
{
  "title": "给植物擦三片叶子",
  "durationSeconds": 180,
  "steps": ["挑三片顺眼的。擦完就回来"]
}
```

动态任务不是操作手册：

- `title` 直接写动作，不写主题或疗愈概念；
- `steps` 通常只包含一句，最多两句自然补充；
- 不使用“首先、然后、接下来、最后”；
- 不把动作拆成用户已经知道的微小步骤；
- 不解释效果或任务意义；
- 每个任务只包含一个主动作和一个明确停止点；
- 总时长为 1 至 6 分钟；
- 最多移动到一个新地点；
- 不要求持续看屏幕。

可选的落地段为 0 至 90 秒。它不固定为呼吸训练，可选择熄灭屏幕、手离开键盘、
自然坐一会、站稳、看远处或听一个声音。短任务可以直接开始，不强制加入落地段。
不得要求深呼吸、憋气、计数呼吸或声称呼吸会产生治疗效果。

## 受控随机

多样性不依赖提高模型 temperature。服务端在调用模型前随机形成内部 task brief：

```text
taskFamily: care | space | movement | sensory | explore
voiceVariant: question | observation | lightly_playful | minimal
landingStyle: none | short_pause | sensory_pause
```

这些值只进入模型输入，不加入公共 API 响应。服务端先根据 Mode、地点和可用时间
筛出允许类别，再通过可注入、可测试的随机选择器挑选组合。当前请求没有稳定的用户
或设备标识，也没有最近任务类别字段，因此第一版不承诺跨请求避重。若后续要做到
“最近两次不重复”，必须先设计最小化的客户端历史输入，不能使用全局服务端历史把
不同用户混在一起。

任务类别定义：

| 类别 | 示例 | 额外边界 |
|---|---|---|
| `care` | 洗脸、洗手、接水、喝水、短洗澡 | 洗澡只用于地点明确且时间足够的主动休息；不随机要求上厕所 |
| `space` | 收起三样物品、整理一个手掌大小、擦三片叶子 | 必须有数量、面积或时间停止点，不升级为家务 |
| `movement` | 走一圈、活动脚踝、扶稳固椅背做低风险动作 | 只从审核过的动作模式生成，不自由编写健身技术指导 |
| `sensory` | 听完一首歌、找颜色、看云、听远处声音 | 不强制闭眼，不要求持续看屏幕 |
| `explore` | 换一个角落、找一把没坐过的椅子、去 Rest Anchor | 只能使用输入明确提供的安全地点 |

## Mode 边界

### Mode A：自动提醒

Mode A 只使用不依赖未知地点、能随手开始的任务：桌边低风险活动、洗脸洗手、
接水、微小整理、感官任务和室内短距离走动。

- 目标时长为 1 至 3 分钟；
- 不生成洗澡、楼顶或陌生地点探索；
- 不猜测用户在宿舍、图书馆、办公室或家中；
- `shouldOfferRest=false` 时只返回简短陪伴状态，不生成任务；
- `shouldOfferRest=true` 时 `message` 接住真实信号，随后直接呈现任务。

### Mode B：主动休息

Mode B 可根据现有 `availableMinutes` 和 `locationTags` 开放更多任务：

- `home` / `dorm`：短洗澡、绿植、阳台或明确的公共区域；
- `library`：用户提供的角落、椅子或室内 Rest Anchor；
- `office`：饮水机、走廊、窗边；
- 明确安全的户外 Rest Anchor：短距离探索。

地点标签为空时不得生成依赖具体场所的任务。Apple 客户端当前传入空
`locationTags` 的路径只能使用地点无关任务；要启用探索类任务，必须先接入用户明确
提供的地点标签或 Rest Anchor，不能由模型猜测。

## Apple 呈现

当前 Dynamic Rest 和固定 Quest 共用会自动编号的步骤列表。为了避免模型文案经过
UI 后重新变成说明书：

- Dynamic Rest 的 `steps` 使用无序、无编号的自然补充文案；
- Contract 1.0 固定 Quest 暂时保留现有编号展示；
- 标题、前置 `message` 和补充句不得重复同一个动作；
- Dynamic Rest 最多显示两句补充，避免撑满紧凑面板。

这不改变 `GeneratedRestTask` Codable 或 Contract 1.1 JSON 字段形状。时长范围、非空
标题和一至两条非空补充属于更严格的契约校验，必须同步更新 OpenAPI、JSON Schema、
TypeScript Schema、fixtures、contract tests 和受影响的 Apple 消费者测试。

## Prompt 版本

语义、任务范围和语言规范均有变化，因此使用新的 Prompt 版本：

```text
dynamic-rest-decision-v1.2
dynamic-manual-rest-v1.2
```

Wire Contract 继续为 `1.1`。Prompt、task brief 构造和评测 fixtures 必须一同接受
代码评审，不允许通过远程环境变量替换完整 Prompt。

旧的本地 `server/src/agent/prompts/always-on-companion-agent.md` 仅作为语气、真实
性、隐私和健康安全参考。其固定 Quest 输出、原有 AI 陪伴腔示例和 Contract 1.0
结构不迁移。

## 输出示例

### Mode A

```json
{
  "shouldOfferRest": true,
  "reasonCode": "long_continuous_use",
  "message": "看挺久了吧。",
  "generatedTask": {
    "title": "去接杯水",
    "durationSeconds": 150,
    "steps": ["手机留下。回来时绕一点路"]
  }
}
```

```json
{
  "shouldOfferRest": false,
  "reasonCode": "insufficient_signal",
  "message": "这会儿不用停。",
  "generatedTask": null
}
```

### Mode B

```json
{
  "message": "好。",
  "generatedTask": {
    "title": "完整听一首歌",
    "durationSeconds": 240,
    "steps": ["就一首，中途别切"]
  }
}
```

```json
{
  "message": "走，换个地方。",
  "generatedTask": {
    "title": "找把没坐过的椅子",
    "durationSeconds": 180,
    "steps": ["坐两分钟，看看那里平时是什么声音"]
  }
}
```

## 失败行为

现有严格 JSON 解析、Schema 校验、Provider 超时和脱敏错误路径保持不变。以下输出
可由结构 Schema 确定性拒绝：

- 时长不在 1 至 6 分钟；
- 空标题、空补充或超过两条补充；
- Mode A false 分支携带任务，或 true 分支缺少任务。

以下内容约束由受控 task brief、Prompt、审核过的 movement patterns 和真实模型评测
共同保证，不声称仅靠 JSON Schema 就能理解自然语言并拒绝：

- 与所选 task family 或场景不兼容；
- 使用输入中不存在的具体地点；
- 整理任务没有停止点；
- 未审核的身体动作、诊断、治疗声称或设备控制；

第一版不增加模型修复重试，避免把超时和不可预测延迟扩大。无效输出沿用当前
`LLM_INVALID_OUTPUT` 失败路径，客户端回到可用状态且不替换为固定 Quest。

## 评测与验收

### 确定性测试

- Prompt 版本、Mode 和 task brief 正确传入；
- Mode A 与 Mode B 使用不同的场景边界；
- 输出 Schema 校验时长、标题、补充数量和 true/null 关系；
- 注入式用户标签仍只作为数据；
- 估算连续时长不会进入必须精确表达的示例；
- Dynamic Rest UI 不编号，固定 Quest UI 行为不变；
- Provider 401/403、429、超时、5xx、无效 JSON 和无效结构仍走现有安全失败路径。

### 真实模型语气评测

建立固定场景集，覆盖低信号、长连续使用、频繁切换、深夜、低精力、刚休息过、
主动安静、主动活动、地点为空和地点明确等情况。

对相同允许场景采样多次，验收标准为：

1. 使用固定随机种子运行选择器时，全部允许的 task family 和 voice variant 均可到达；
2. 一组不少于四十次的真实模型采样中，至少覆盖四个 task family；
3. 至少 80% 的任务不以呼吸、看远或放松肩膀为主动作；
4. 不出现抽象疗愈语言、诊断、内疚施压或虚假设备能力；
5. 不出现三步教学式表达；
6. 看一眼即可知道要做什么；
7. 自动模式不编造地点，主动模式只使用已提供地点；
8. 两名评审盲测旧版与新版文案，新版在人味、具体性和执行意愿三项中多数胜出。

评测记录保留输入场景、Prompt 版本、结构化输出和人工评分，不记录密钥、完整
Provider 错误体或未脱敏的私人上下文。

## 参考材料

- 本地旧稿：`Hush-UnifiedInbox/server/src/agent/prompts/always-on-companion-agent.md`
- 产品方案：`Hush — An Ambient Rest Agent（最终整合版 v3.0）`
- 小红书公开慢生活与徒步文案整理：
  `https://www.digitaling.com/articles/843037.html`
- 小红书户外文案创作访谈：
  `https://www.digitaling.com/articles/935962.html`
- 小红书 City Walk 文案整理：
  `https://www.digitaling.com/articles/970297.html`

参考材料只用于提炼“具体场景、短句、生活便利贴式提议”的写作机制，不复制具体
文案，不迁移营销式宏大表达，也不把二手整理页当作普通用户语言样本。
