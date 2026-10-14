'use strict';

/** 统一校验分支名称；名称中的子目录由 Git 自身继续校验。 */
function isAllowed(name) {
  return /^(?:main|dev|(?:feature|fix)\/.+)$/.test(name);
}

/** 校验并纠正远端分支，功能分支触发时将最新功能提交串行合入 dev。 */
async function govern({github, context, core}) {
  const {owner, repo} = context.repo;
  const rows = [];
  const failures = [];
  const fail = message => {failures.push(message); core.error(message);};

  // PR（包括 fork）只验证，不使用写 API。
  if (context.eventName === 'pull_request') {
    const name = context.payload.pull_request.head.ref;
    if (!isAllowed(name)) core.setFailed(`Invalid PR branch: ${name}`);
    return rows;
  }
  if (context.eventName === 'create' && context.payload.ref_type !== 'branch') return rows;
  if (context.payload.deleted) return rows;

  const list = () => github.paginate(github.rest.repos.listBranches, {owner, repo, per_page: 100});
  let branches = await list();
  const names = new Set(branches.map(branch => branch.name));
  for (const branch of branches) {
    if (isAllowed(branch.name)) continue;
    const prefix = `fix/recovered/${branch.name}`;
    let recovered = prefix;
    let suffix = 0;
    while (names.has(recovered)) recovered = `${prefix}-${branch.commit.sha.slice(0, 8)}-${++suffix}`;
    try {
      await github.rest.repos.renameBranch({owner, repo, branch: branch.name, new_name: recovered});
      names.delete(branch.name);
      names.add(recovered);
      rows.push([branch.name, `renamed to ${recovered}`]);
      core.info(`Preserved ${branch.commit.sha}: ${branch.name} -> ${recovered}`);
    } catch (error) {
      fail(`Cannot rename ${branch.name}: HTTP ${error.status || 'unknown'} ${error.message}`);
    }
  }

  const pushed = context.eventName === 'create' ? context.payload.ref : context.ref.replace(/^refs\/heads\//, '');
  const integrate = context.eventName === 'workflow_dispatch' || pushed.startsWith('feature/');
  if (integrate) {
    try {
      await github.rest.repos.getBranch({owner, repo, branch: 'dev'});
    } catch (error) {
      if (error.status !== 404) throw error;
      const main = await github.rest.repos.getBranch({owner, repo, branch: 'main'});
      await github.rest.git.createRef({owner, repo, ref: 'refs/heads/dev', sha: main.data.commit.sha});
    }

    // 每次重新枚举所有 feature，弥补 GitHub concurrency 仅保留一个 pending 运行的行为。
    branches = await list();
    const features = branches.filter(branch => branch.name.startsWith('feature/'));
    features.sort((a, b) => Number(b.name === pushed) - Number(a.name === pushed) || a.name.localeCompare(b.name));
    for (const branch of features) {
      try {
        const result = await github.rest.repos.merge({
          owner, repo, base: 'dev', head: branch.commit.sha,
          commit_message: `merge: integrate ${branch.name} into dev`,
        });
        const status = result.status === 204 ? 'already included' : `merged ${result.data.sha}`;
        rows.push([branch.name, status]);
        core.info(`${branch.name}: ${status}`);
      } catch (error) {
        // GitHub 检测到冲突时不覆盖代码，仍继续处理其他功能分支。
        fail(`Cannot merge ${branch.name} into dev: HTTP ${error.status || 'unknown'} ${error.message}`);
        rows.push([branch.name, 'failed; histories preserved']);
      }
    }
  }

  if (core.summary) {
    await core.summary.addHeading('Branch governance').addTable([
      [{data: 'Branch', header: true}, {data: 'Result', header: true}], ...rows,
    ]).write();
  }
  if (failures.length) core.setFailed(failures.join('\n'));
  return rows;
}

module.exports = {isAllowed, govern};
