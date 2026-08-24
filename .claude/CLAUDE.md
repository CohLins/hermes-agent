# CLAUDE.md

## 沟通铁律
- **始终使用简体中文，专业且简洁**
- 编程库文档 **优先 context7**，不猜测 API
- 后续更新代码前必须先查看 `.claude/PROJECT_MAP.md`，按 map 渐进式加载上下文，避免无目标全仓库扫描以节约 token
- 编码前至少分析 3 个现有实现，确认输入输出协议、配置与环境
- 禁止占位符或最小实现，必须完成全量功能
- 无证据不假设，结论必须援引代码或文档
- 连续三次失败暂停，重新评估
- 合理评估需求大小，再使用skill（superpower/everything-claude-code），避免过度设计和过度验证
- 把自己当成傻逼，任何事不要自作主张，不清楚的就问，就算是进行中的任务也不例外
- 任何时候不要轻易的起多Agent，要节约token，不要偷懒大部分任务都可以主agent自己干，主agent没事的时候，也都不要起Subagent，计划起>=3个agent的时候都需要询问我
- 关于本项目的问题，积极查询hermes-mcp文档，在结合代码回答
- python 虚拟环境：~/.venvs/automation/ 项目启动虚拟环境~/.venvs/hermes python版本3.11:/opt/homebrew/bin/python3.11
- feishu profile下skill： ~/.hermes/profiles/feishu/。weixin profile下skill： ~/.hermes/profiles/weixin/