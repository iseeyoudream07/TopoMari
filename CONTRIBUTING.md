# Contributing

感谢你参与 TopoMari。

## 本地开发

要求 Node.js 22.13 或更高版本。

```bash
cp .env.example .env
cp config/topology.example.json config/topology.json
npm start
```

保持 `KOMARI_BASE_URL` 为空即可使用演示模式。

## 提交前检查

```bash
npm run check
npm test
npm run audit:public
```

请同时确认：

- 没有提交 `.env`、`config/topology.json`、`config/agents.json` 或 `data/*.db`。
- 示例域名使用 `example.com`。
- 示例 IPv4 使用 RFC 5737 文档地址段，例如 `192.0.2.0/24`、`198.51.100.0/24` 或 `203.0.113.0/24`。
- 测试和文档不包含真实节点 UUID、Token、Cookie、Authorization 或个人服务器信息。
- 新行为包含相应测试和必要文档。

## Pull Request

Pull Request 应简要说明：

1. 修改解决的问题。
2. 安全或兼容性影响。
3. 已执行的验证命令。
4. 如涉及 UI，附上不含私人数据的截图。

请保持修改聚焦，避免在同一 PR 中混入无关重构。
