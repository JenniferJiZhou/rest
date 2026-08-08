# Hush 常亮陪伴模式：上滑触发式退出动画修改任务

## 工作位置

- 当前分支：`feat/m1/ui-raster-companion-backup`
- 当前工作区：`Hush-UnifiedInbox`
- 主要文件：
  - `apps/HushApp/iOSApp/App/HushApp.swift`
  - 如确有必要，可调整 `apps/HushApp/Shared/DesignSystem/Wave/HushWaveBackground.swift`

请直接在当前未提交工作上继续，不要覆盖或回退现有的 Companion 背景、海水素材、
休息任务排版、Sleep Handoff、Server 或 Contract 改动。

## 目标

修改“常亮陪伴模式”向上滑退出的交互。

当前问题是 `exitProgress` 直接跟随手指移动，海水会被手指拖着走。目标交互应与
Hush 主页面向上滑进入消息页面的方式一致：

1. 手指上滑只负责触发动画。
2. 达到较短的触发阈值后，动画立即脱离手指。
3. 触发后即使手指停下、放开或向下移动，动画也应按照自己的时间轴继续播放完成。
4. 海水不再与手指移动距离逐帧绑定。
5. 整体动画比当前 `1.35s` 更慢、更沉静，节奏尽量与主页面的潮水动画一致。

## 交互要求

请参考当前已经实现的：

- `HushDoorView` 中的 `onInboxSwipeTriggered`
- `HushDemoRootView.startInboxTide()`
- `HushTideTimeline`

不要重新设计另一套拖拽逻辑或动画曲线。本次应优先复用主页已经验证过的代码，
以更快完成并保持两个入口的手感一致。

### 必须优先复用的现有实现

1. 复用 `HushDoorView` 已验证的“短距离或向上 flick 只触发一次”交互原则。
2. 复用 `HushDemoRootView.startInboxTide()` 的状态组织方式：
   - 独立的开始时间；
   - 独立的自动播放状态；
   - 触发后忽略手指；
   - 动画完成后才切换页面。
3. 直接使用 `HushTideTimeline.tideDuration` 和
   `HushTideTimeline.tideProgress(elapsed:)` 驱动 Companion 的
   `exitProgress`，不要另写一套 easing、分段计时器或手动递增循环。
4. Companion 继续使用自己的 `HushCompanionBackground` 和三张海面素材；
   只复用“触发与时间轴”，不要把主页背景或 Inbox 页面复制进来。
5. 如果为了避免复制少量状态代码而需要抽取一个非常小的共享
   triggered-tide driver，可以抽取；不要进行大规模架构重构。

验收时应能明确指出复用了哪些现有类型或函数，而不是仅仅实现出一个看起来相似的
新版本。

### 触发前

- 用户从屏幕下半部分做明确的向上滑动。
- 可以保留很轻的“蓄势”反馈，但海水和退出画面不能跟随手指上升。
- 建议沿用主页面约 `44pt` 的触发距离，或清晰的向上 flick 触发。
- 没有达到阈值就松手时，不退出，也不播放海水动画。

### 触发后

- 每次手势只能触发一次。
- 设置独立的动画开始时间或自动进度状态。
- `exitProgress` 从 `0` 自动、连续、单调地走到 `1`。
- 不再读取当前手指位置，也不能因为手指回撤而倒放或取消。
- 动画过程中禁止重复触发、点击展开详情或长按请求任务。
- 动画结束后再执行现有的：
  - `model.stop()`
  - `onClose()`

### 动画速度

- 普通模式直接复用主页面 `HushTideTimeline.tideDuration` 和
  `HushTideTimeline.tideProgress(elapsed:)`，目前完整时间约为 `4.3s`。
- 第一版先不要为 Companion 单独修改时长或曲线。只有产品方看过实际效果并明确提出
  后，才单独微调。
- 不要让动画前半段突然冲上去、后半段长时间停住；三张海面阶段必须连续、平缓。
- Reduce Motion 继续保留快速完成路径，约 `0.2s`，不强制播放完整慢动画。

## 实现边界

本次只改常亮陪伴模式的上滑退出手势和对应动画驱动。

不要修改：

- Companion Agent 请求和返回结构
- 工作计时逻辑
- 自动收起详情逻辑
- 休息任务内容和排版
- 主页面 Door → Inbox 已有动画
- Sleep Handoff
- 通知、锁定、Mac 监测或 Server
- Contract、Signing、Bundle ID、Entitlements

不要删除或替换 Cloud 已加入的四张 Companion PNG 素材，也不要把
`HushCompanionBackground` 重新合并回 `HushWaveBackground`。

## 验收场景

至少验证以下情况：

1. 短距离上滑但未达到阈值：页面保持原状，海水不跟手、不退出。
2. 达到阈值后立即松手：海水仍自动缓慢播放到结尾并退出。
3. 达到阈值后手指向下回撤：动画不倒退、不取消。
4. 快速向上 flick：只触发一次，自动完整播放。
5. 动画播放期间再次滑动、点击或长按：不会重复触发或改变状态。
6. 完成后只调用一次 `onClose()`。
7. Reduce Motion 开启时快速、稳定退出。
8. iOS `Hush` Scheme 构建通过。
9. Mac target 不因共享文件修改而出现构建回归。
10. 主页面上滑进入消息的动画和手势保持不变。

## 完成后回复

请说明：

1. 修改了哪些文件。
2. 使用的触发距离和 flick 判定。
3. 普通模式与 Reduce Motion 的动画时长。
4. 如何保证触发后动画不再跟随手指。
5. 上述验收场景的测试结果。
6. iOS 和 Mac 构建结果。

完成后先保留为本地未提交改动，不要提交、推送或合并，等待产品方确认手感。
