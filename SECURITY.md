# Security Policy

## Supported versions

安全修复以最新发布版本为准。

## Reporting a vulnerability

请使用 [GitHub Private Vulnerability Reporting](https://github.com/iseeyoudream07/TopoMari/security/advisories/new) 私下报告安全问题。不要在公开 Issue、日志或截图中粘贴以下内容：

- Komari Cookie 或 Authorization
- Dashboard 密码
- Agent Token 或 enrollment code
- `config/agents.json`
- `.env`
- SQLite 数据库
- 私有节点地址或未公开的基础设施信息

报告中请包含受影响版本、复现条件、潜在影响和最小化的复现步骤。收到报告后，维护者应先确认问题，再协调修复和披露时间。

如果凭据已经出现在公开提交中，请立即轮换相关凭据；仅删除最新文件不能从 Git 历史中清除秘密。
