import type { Skill } from "@/types";

/** 数据来自设计原型 index.html:37，正文补齐为可阅读的 skill.md。 */
export const skills: Skill[] = [
  {
    id: "log-analysis",
    name: "日志分析",
    description: "从结构化日志中提取异常模式、错误上下文与时间线。",
    version: "v1.4.0",
    scene: "故障排查",
    status: "已启用",
    markdown: `# 日志分析

从结构化日志中提取异常模式、错误上下文与时间线，输出可复现的查询条件与结论。

## 适用场景

- 服务出现集中报错，需要快速定位错误码与首次发生时间
- 发布后异常回溯，对比发布前后的错误分布
- 告警归因时补齐日志证据

## 输入约定

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| \`service\` | 是 | 日志中的 app_name，需在服务配置范围内 |
| \`time_range\` | 是 | 查询时间窗口，默认最近 30 分钟 |
| \`keyword\` | 否 | 错误码、异常类名或关键字 |

## 输出约定

\`\`\`json
{
  "range": "最近 30 分钟",
  "source": "示例数据",
  "conclusion": "错误集中在 payment-service 的回调处理",
  "evidence": ["日志片段", "错误码分布"],
  "next_steps": ["确认下游回调超时", "查看关联 Trace"]
}
\`\`\`

> 阶段一为本地 Mock，不发起真实日志查询。`,
  },
  {
    id: "service-health",
    name: "服务健康巡检",
    description: "聚合服务状态、实例健康与近期异常，形成巡检摘要。",
    version: "v1.1.2",
    scene: "日常巡检",
    status: "已启用",
    markdown: `# 服务健康巡检

聚合服务状态、实例健康与近期异常，形成一份可直接发给值班同学的巡检摘要。

## 适用场景

- 每日晨间巡检、发布前后的健康确认
- 定时任务里的自动巡检来源

## 输出约定

- 健康服务数 / 总服务数
- 按错误率与 P95 延迟排序的异常候选
- 每个异常项附带下一步建议

> 阶段一为本地 Mock，指标均标注「示例数据」。`,
  },
  {
    id: "sql-performance",
    name: "SQL 性能分析",
    description: "识别慢 SQL、调用来源与可能的索引优化方向。",
    version: "v0.9.6",
    scene: "性能优化",
    status: "已启用",
    markdown: `# SQL 性能分析

识别慢 SQL、调用来源与可能的索引优化方向。

## 输入约定

- \`service\`：调用方服务名
- \`threshold\`：慢查询阈值，默认 200ms

## 输出约定

- SQL 摘要、平均耗时、最大耗时、出现次数
- 调用链上的入口接口
- 索引与锁等待的初步判断

\`\`\`sql
SELECT stock FROM sku_inventory
WHERE sku_id = ?
FOR UPDATE
\`\`\`

> 阶段一为本地 Mock，不连接任何数据库。`,
  },
  {
    id: "alert-attribution",
    name: "告警归因",
    description: "将告警与日志、链路和任务执行记录关联。",
    version: "v0.8.1",
    scene: "事件响应",
    status: "已启用",
    markdown: `# 告警归因

将告警与日志、链路和任务执行记录关联，给出影响范围与责任服务。

## 处理流程

1. 读取告警的触发条件与时间窗口
2. 拉取同窗口的日志与 Trace 证据
3. 关联最近的定时任务执行记录
4. 输出归因结论、影响范围与下一次更新时间

> 阶段一为本地 Mock，不消费真实告警事件。`,
  },
];
