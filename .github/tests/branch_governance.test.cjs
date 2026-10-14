const assert = require('node:assert/strict');
const {test} = require('node:test');
const {isAllowed, govern} = require('../scripts/branch_governance.cjs');

function fixture(names, eventName = 'push', branch = 'feature/topic') {
  const calls = {merge: [], rename: [], create: [], failures: []};
  let branches = names.map(name => ({name, commit: {sha: `sha-${name}`}}));
  const github = {
    paginate: async () => branches,
    rest: {repos: {
      listBranches: () => {},
      getBranch: async ({branch}) => {
        const found = branches.find(item => item.name === branch);
        if (!found) throw Object.assign(new Error('missing'), {status: 404});
        return {data: found};
      },
      renameBranch: async ({branch, new_name}) => {
        calls.rename.push([branch, new_name]);
        branches = branches.map(item => item.name === branch ? {...item, name: new_name} : item);
        return {data: branches.find(item => item.name === new_name)};
      },
      merge: async args => {calls.merge.push(args); return {status: 201, data: {sha: 'merged'}};},
    }, git: {
      createRef: async args => {calls.create.push(args);},
    }},
  };
  const core = {info: () => {}, error: () => {}, setFailed: text => calls.failures.push(text)};
  const context = {
    repo: {owner: 'owner', repo: 'repo'}, eventName,
    ref: `refs/heads/${branch}`, payload: {},
  };
  return {github, core, context, calls};
}

test('only the four requested branch formats are accepted', () => {
  for (const name of ['main', 'dev', 'feature/a', 'feature/a/b', 'fix/a', 'fix/a/b']) assert.equal(isAllowed(name), true);
  for (const name of ['master', 'release/v1', 'hotfix/a', 'feature', 'feature/', 'fix/', 'dev/a']) assert.equal(isAllowed(name), false);
});

test('feature push merges all current feature heads, compensating for superseded pending events', async () => {
  const f = fixture(['main', 'dev', 'feature/a', 'feature/b', 'fix/c'], 'push', 'feature/b');
  await govern(f);
  assert.deepEqual(f.calls.merge.map(call => call.head), ['sha-feature/b', 'sha-feature/a']);
  assert.ok(f.calls.merge.every(call => call.base === 'dev'));
  assert.deepEqual(f.calls.failures, []);
});

test('conflict preserves histories and still processes another feature', async () => {
  const f = fixture(['main', 'dev', 'feature/a', 'feature/b']);
  f.github.rest.repos.merge = async args => {
    f.calls.merge.push(args);
    if (args.head === 'sha-feature/a') throw Object.assign(new Error('Merge conflict'), {status: 409});
    return {status: 201, data: {sha: 'merged'}};
  };
  await govern(f);
  assert.equal(f.calls.merge.length, 2);
  assert.equal(f.calls.failures.length, 1);
  assert.equal(f.calls.rename.length, 0);
});

test('private fallback renames an invalid branch and handles an occupied recovery name', async () => {
  const f = fixture(['main', 'dev', 'release/v1', 'fix/recovered/release/v1'], 'create', 'release/v1');
  f.context.payload = {ref_type: 'branch', ref: 'release/v1'};
  await govern(f);
  assert.equal(f.calls.rename[0][0], 'release/v1');
  assert.ok(f.calls.rename[0][1].startsWith('fix/recovered/release/v1-'));
  assert.equal(f.calls.merge.length, 0);
});

test('fork PR validates the head name without writes', async () => {
  const f = fixture(['main', 'dev'], 'pull_request');
  f.context.payload = {pull_request: {head: {ref: 'feature/fork'}}};
  await govern(f);
  assert.deepEqual([f.calls.merge, f.calls.rename, f.calls.create, f.calls.failures], [[], [], [], []]);
});

test('invalid PR fails without mutating repository branches', async () => {
  const f = fixture(['main', 'dev'], 'pull_request');
  f.context.payload = {pull_request: {head: {ref: 'release/fork'}}};
  await govern(f);
  assert.equal(f.calls.failures.length, 1);
  assert.deepEqual([f.calls.merge, f.calls.rename, f.calls.create], [[], [], []]);
});

test('fix pushes and deleted feature pushes do not merge', async () => {
  for (const deleted of [false, true]) {
    const f = fixture(['main', 'dev', 'feature/a'], 'push', deleted ? 'feature/a' : 'fix/a');
    f.context.payload.deleted = deleted;
    await govern(f);
    assert.equal(f.calls.merge.length, 0);
  }
});

test('missing dev is created from main before feature integration', async () => {
  const f = fixture(['main', 'feature/a']);
  await govern(f);
  assert.deepEqual(f.calls.create, [{owner: 'owner', repo: 'repo', ref: 'refs/heads/dev', sha: 'sha-main'}]);
  assert.equal(f.calls.merge.length, 1);
});
