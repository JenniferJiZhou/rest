# 09｜Coding Agent 任务协议

## 1. 原则

Coding Agent 适合：

- 独占目录内的小功能。
- 基于冻结契约生成模型、Mock、测试。
- 编写 UI Feature 或 provider 实现。
- 补充单元测试与错误状态。
- 修复明确可复现 Bug。

Coding Agent 不适合自行决定：

- 产品范围。
- 数据契约。
- Xcode target/capability。
- Gmail scope。
- Photon line 配置。
- 新依赖。
- 跨目录重构。
- Demo 真实性表述。

## 2. 标准任务卡

```markdown
# TASK-<编号>：<名称>

## 背景
<为什么做>

## Owner
M1 / M2 / W1 / W2

## 允许修改
- path/**

## 禁止修改
- contracts/**
- apps/HushApp/Hush.xcodeproj/**
- ...

## 依赖契约
- contracts/schemas/...
- contracts/fixtures/...

## 输入
- ...

## 输出
- ...

## 验收
1. ...
2. ...
3. ...

## 测试命令
- ...

## 降级要求
- ...

## 完成后报告
- 修改文件
- 测试结果
- 未解决问题
```

## 3. Agent 工作区

若一个成员并行使用 Agent：

```bash
git worktree add ../hush-agent-m2-wave -b feat/m2/wave-ui main
```

规则：

- 一个 worktree 对应一个任务。
- Agent 不访问人的主工作区。
- 不让两个 Agent 修改同一目录。
- 完成后由人查看 `git diff`。
- 验证后 squash/cherry-pick。
- 删除 worktree 前确认无未提交内容。

## 4. 审查清单

- 是否越界修改？
- 是否修改了 schema/枚举？
- 是否硬编码 API key/URL？
- 是否跳过 Mock？
- 是否让 LLM 生成自由动作？若是 Contract 1.1 Mode A / Mode B
  的已批准局部例外，
  是否仍限制为结构化办公休息任务且不控制设备/通知/checkpoint？
- 是否保存私人输入？
- 是否新增了依赖？
- 是否破坏 macOS/iOS 共享 Feature？
- 是否有编译或契约测试证据？
- 是否诚实说明失败？

## 5. 禁止的模糊任务

不要给 Agent：

- “把后端做完”
- “做完整 iOS”
- “优化整个架构”
- “把所有接口接好”
- “随便设计一个数据库”
- “修复所有 Bug”

必须拆成一个目录、一个契约、一个验收。
