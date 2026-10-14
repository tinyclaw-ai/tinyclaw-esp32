# 分支规范

仅允许 `main`、`dev`、`feature/<非空名称>`、`fix/<非空名称>`，名称内可含子目录。

- `main`：默认稳定分支。功能代码不会自动发布到 main。
- `dev`：持续集成分支。
- `feature/*`：功能开发分支；推送或创建后，由 Branch governance 工作流将最新功能提交合入 dev。
- `fix/*`：修复分支；命名允许，但不自动合并。

## 本地执行

首次检出运行：

```sh
git config core.hooksPath .githooks
```

若已有 hooksPath，请先合并现有 hook，不直接覆盖。reference-transaction hook 在本地引用事务提交前拒绝非法分支的创建和更新，允许删除历史非法分支，不限制标签和远端跟踪引用。更改配置或显式绕过 hook 可以绕过本地校验。

## GitHub 执行

公开仓库启用 `.github/branch-ruleset.json` 规则：对不合规名称禁止创建和更新，保留清理能力。当前私有仓库套餐不支持 ruleset，因此采用创建后的工作流纠正：将非法分支改名为 `fix/recovered/<旧名称>`，重名时追加提交前缀和序号，保留提交历史。私有仓库无法在服务器创建前拒绝非法名称；严格服务器阻断需要升级至支持 ruleset 的套餐，不能将 CI 纠正当作同等能力。

工作流从 main 加载治理代码，不执行推送分支的业务源码。PR（包括 fork）仅检查名称。每次功能触发重新枚举全部 feature 分支并串行合并到 dev，避免并发 pending 事件被覆盖导致漏合。GitHub API 合并保留历史；冲突时失败并保留双方代码，不强推。删除分支及 fix 推送不自动合入 dev。

无需新增秘密，工作流仅使用 `GITHUB_TOKEN` 的 `contents: write`。该 token 引发的 dev 更新不会递归触发其他 push 工作流；本流程只验证治理逻辑，不代替业务 CI、固件或生产验证。可从 Actions 手动运行 Branch governance 重新检查全部 feature。

## 校验命令

```sh
node --test .github/tests/branch_governance.test.cjs
python3 -m unittest discover -s .github/tests -p 'test_*.py' -v
```
