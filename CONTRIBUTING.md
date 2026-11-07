# 贡献指南

感谢你愿意为 Spider 做出贡献。我们通过 GitHub Issue 讨论和确认工作，再通过 Pull Request（PR）提交代码。请先阅读本指南，并按对应流程参与。

## 反馈 Bug

发现 Bug 时，请先搜索现有 Issue，确认没有重复报告，再创建一个 Bug Issue。请尽量提供：

- 清晰的标题和问题描述
- 复现步骤，以及预期结果和实际结果
- 运行环境、相关版本和必要的日志或截图

## 提议功能

添加功能前，请先创建一个 **Proposal Issue**。Issue 应准确、清晰地说明：

- 要解决的问题或用户需求
- 期望的行为和范围
- 为什么需要这项改动
- 如何验收：列出可验证的验收标准，说明什么结果代表需求已满足
- 可行时，提供使用场景、示例或备选方案

请先在 Issue 中讨论方案。**只有 Issue 获得 `approved` 标记或明确批准后，才开始实现并提交 PR。**未获批准的 Proposal 不代表可以开始开发；这样可以先对齐需求和方向，避免重复或不符合项目目标的工作。

## Issue 标签与状态

Issue 用少量标签表达类型和当前需要的动作。仓库使用以下标签：

| 标签                  | 用途                          |
| --------------------- | ----------------------------- |
| `type: bug`           | Bug 报告                      |
| `type: proposal`      | 新功能或行为变更提议          |
| `status: approved`    | Proposal 已批准，可以开始实现 |
| `status: in-progress` | 已有人着手处理，通常关联 PR   |

状态标签只用于标记已批准的 Proposal 和正在进行的工作。Proposal 必须先标记 `status: approved`，贡献者才应开始实现；开始处理后改为 `status: in-progress`。工作完成后关闭 Issue，不需要额外的完成状态标签。标签名称是建议的仓库约定；如果仓库尚未创建某个标签，请在 Issue 中注明对应状态。

## 提交 Pull Request

Issue 获批后，可以围绕该 Issue 提交 PR。提交前请：

1. 确认 `upstream` remote 指向 Spider 的主仓库；`origin` 通常指向你自己的 fork。将本地分支基于主仓库最新的 `main` 进行 rebase：

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. 解决可能出现的冲突，并按项目要求检查改动。
3. 在 PR 描述中关联对应 Issue，并说明改动内容。
4. 附上 benchmark 报告，便于审查改动对性能的影响。
5. 如果改动涉及页面外观或交互，请附上修改前后截图，或至少提供修改后的截图。

请保持提交聚焦于关联 Issue。PR 经过审查和批准后，由维护者使用 **Squash and merge** 合并。仓库不接受直接 Merge commit；请勿使用普通的 **Create a merge commit** 合并方式。
