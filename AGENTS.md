# AGENTS.md

## 开发上下文入口

开始插件开发前，先阅读[插件开发指南](docs/插件开发指南.md)。指南记录目标 Harness 版本、没有创造模式时的接口查证方法、Host/Client 接入惯例，以及构建、加载和验证流程；适用于其他编码 Agent 和人工维护者。

接口以目标版本的 SDK 和实际运行实例为准，不凭旧教程或模型记忆猜测。产品行为见[设计文档](docs/设计文档.md)，测试与真实页面验收边界见[验证说明](docs/验证说明.md)。

## 项目定位

dsh-recap 是 DeepSeek Harness 的会话回顾插件。
目标不是替代 compact、memory 或知识库，而是在用户离开、恢复会话或主动请求时，帮助快速恢复当前工作的上下文。

核心原则：

- 默认不修改模型上下文。
- 默认不新增 session event。
- 不把推断内容伪装成事实。
- 不阻塞主 Agent 流程。
- 所有自动任务必须可取消、可失效。

## 架构约束

项目分为三层：

```
src/core   纯逻辑：事实整理、状态机、缓存、文本处理
src/host   Harness 集成：命令、配置、HTTP、LLM 调用
src/client UI：聊天回顾文字、设置页、用户交互
```

修改时优先保持 core 无 Harness 依赖，host 负责接入，client 只负责展示。

## Harness 开发注意事项

- 不新增未知 session event type。
- 使用 sessionProjections 获取派生事实。
- 不直接扫描完整 session 日志计算 UI 数据。
- 命令通过 dsh-commands 注册。
- 设置使用 Harness settings 机制，保持 revision 冲突保护。
- Client 使用 ModuleLoader 方式加载，不打包 React 或 Harness UI 包。

## Recap 内容原则

回顾展示应该回答：

1. 用户正在做什么？
2. 已经完成什么？
3. 当前停在哪里？
4. 下一步可能是什么？

不要简单拼接：

- 最近用户消息
- 最近助手回复
- 原始日志片段

事实模式和模型生成模式必须明确区分，但不要暴露内部工程术语。

## 代码质量要求

- TypeScript strict。
- 修改后运行 typecheck。
- 提交前执行 prettier。
- 新增功能必须增加测试。
- 避免为了测试方便改变生产接口。

## 开源维护原则

保持仓库简洁：

保留：

- 源码
- 必要文档
- 测试
- 配置示例

不要提交：

- coverage
- 截图产物
- 本地日志
- 构建临时文件
- 包含本机路径的信息

## AI 辅助开发规则

AI 修改代码后，需要人工确认：

- 是否符合 Harness 官方接口。
- 是否引入隐藏副作用。
- 是否降低可维护性。
- 是否增加无必要抽象。

优先选择简单、可解释、可测试的实现。
