import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const guard = fileURLToPath(new URL('../../scripts/validate-release-tag.sh', import.meta.url));
const sourceGuard = fileURLToPath(new URL('../../scripts/validate-release-source.sh', import.meta.url));
const npmVersionGuard = fileURLToPath(new URL('../../scripts/validate-npm-publish-version.mjs', import.meta.url));
const zeros = '0'.repeat(40);

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pmsec-release-guard-'));
  const gitEnv = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (args) => execFileSync('git', args, { cwd: directory, env: gitEnv, stdio: 'ignore' });
  git(['init', '--quiet', '--initial-branch=main']);
  const commit = (content, message) => {
    writeFileSync(join(directory, 'snapshot.txt'), `${content}\n`);
    git(['add', 'snapshot.txt']);
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null',
      '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid',
      'commit', '--quiet', '-m', message], { cwd: directory, env: gitEnv, stdio: 'ignore' });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, env: gitEnv, encoding: 'utf8' }).trim();
  };
  const oldSha = commit('older snapshot', 'older');
  const sha = commit('latest snapshot', 'latest');
  return { directory, gitEnv, oldSha, sha, output: join(directory, 'github-output') };
}

function validate(f, options = {}) {
  const env = {
    ...f.gitEnv,
    EVENT_NAME: 'push',
    ACTOR: 'fixture-user',
    REF: 'refs/tags/pmsec-node-v2026.10.3',
    SHA: f.sha,
    BEFORE: zeros,
    INPUT_VERSION: '',
    GITHUB_OUTPUT: f.output,
    ...options,
  };
  return spawnSync('/bin/bash', [guard, options.prefix ?? 'pmsec-node-v',
    options.actualVersion ?? '2026.10.3'], { cwd: f.directory, env, encoding: 'utf8' });
}

function validateSource(f, options = {}) {
  const env = {
    ...f.gitEnv,
    EVENT_NAME: 'workflow_run',
    REF: 'refs/heads/main',
    SHA: f.sha,
    HEAD_SHA: f.sha,
    HEAD_BRANCH: 'main',
    HEAD_REPOSITORY: 'HikaruEgashira/pmsec',
    CONCLUSION: 'success',
    REPOSITORY: 'HikaruEgashira/pmsec',
    ...options,
  };
  return spawnSync('/bin/bash', [sourceGuard], { cwd: f.directory, env, encoding: 'utf8' });
}

test('a new canonical tag push and the bot tag-ref fallback pass the real release guard', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));

  const push = validate(f);
  assert.equal(push.status, 0, push.stderr);
  assert.equal(readFileSync(f.output, 'utf8'), 'version=2026.10.3\n');

  const pyPush = validate(f, { prefix: 'pmsec-py-v', REF: 'refs/tags/pmsec-py-v2026.10.3' });
  assert.equal(pyPush.status, 0, pyPush.stderr);

  const dispatch = validate(f, {
    EVENT_NAME: 'workflow_dispatch',
    ACTOR: 'github-actions[bot]',
    INPUT_VERSION: '2026.10.3',
    BEFORE: '',
  });
  assert.equal(dispatch.status, 0, dispatch.stderr);
});

test('the release guard rejects mismatched versions, non-tag dispatch, non-bot dispatch, tag updates and SHA drift', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));

  const rejected = [
    validate(f, { actualVersion: '2026.10.4' }),
    validate(f, { EVENT_NAME: 'workflow_dispatch', ACTOR: 'github-actions[bot]',
      REF: 'refs/heads/main', INPUT_VERSION: '2026.10.3' }),
    validate(f, { EVENT_NAME: 'workflow_dispatch', ACTOR: 'human',
      INPUT_VERSION: '2026.10.3' }),
    validate(f, { EVENT_NAME: 'workflow_dispatch', ACTOR: 'github-actions[bot]',
      INPUT_VERSION: '2026.10.4' }),
    validate(f, { BEFORE: '1'.repeat(40) }),
    validate(f, { SHA: '2'.repeat(40) }),
    validate(f, { prefix: 'pmsec-py-v' }),
  ];
  for (const result of rejected) assert.notEqual(result.status, 0);
});

test('new package tag pushes start the matching publishers from the event SHA', () => {
  const cases = [
    ['pmsec-release-npm.yml', 'pmsec-node-v'],
    ['pmsec-release-pypi.yml', 'pmsec-py-v'],
  ];

  for (const [name, prefix] of cases) {
    const source = workflow(name);
    assert.match(source, new RegExp(`^on:\\n  push:\\n    tags:\\n      - '${prefix}\\*'`, 'm'));
    assert.match(source, /workflow_dispatch:/);
    assert.match(source, /ref: \$\{\{\s*github\.sha\s*\}\}/);
    assert.match(source, new RegExp(String.raw`bash \.\./scripts/validate-release-tag\.sh ${prefix}`));
    if (name.endsWith('npm.yml')) assert.match(source, /readFileSync\("package.json"/);
    else assert.match(source, /tomllib\.load\(open\("pyproject.toml"/);
  }
});

test('npm trusted publishing uses GitHub-hosted runners and requires a supported npm version', () => {
  const source = workflow('pmsec-release-npm.yml');
  assert.match(source, /runs-on: ubuntu-24\.04/);
  assert.match(source, /node-version: 24/);
  assert.match(source, /validate-npm-publish-version\.mjs/);

  for (const version of ['11.5.1', '11.6.0', '12.0.0']) {
    const result = spawnSync(process.execPath, [npmVersionGuard, version], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const version of ['11.5.0', '10.99.9', 'not-a-version']) {
    const result = spawnSync(process.execPath, [npmVersionGuard, version], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  }
});

test('the release fallback dispatches exact package tags from the verified CI snapshot', () => {
  const source = workflow('pmsec-release.yml');
  assert.match(source, /ref: \$\{\{ github\.event_name == 'workflow_run' && github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/);
  assert.match(source, /run: bash scripts\/validate-release-source\.sh/);
  assert.match(source, /git push --atomic origin HEAD:main "\$node_tag" "\$py_tag"/);
  assert.match(source, /gh workflow run pmsec-release-npm\.yml --ref "pmsec-node-v\$VERSION"/);
  assert.match(source, /gh workflow run pmsec-release-pypi\.yml --ref "pmsec-py-v\$VERSION"/);
  assert.doesNotMatch(source, /gh workflow run .*--ref main/);
});

test('release source guard rejects a newer main checkout for an older successful CI run', (t) => {
  const f = fixture();
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));

  const staleMainCheckout = validateSource(f, { HEAD_SHA: f.oldSha });
  assert.notEqual(staleMainCheckout.status, 0);

  execFileSync('git', ['checkout', '--detach', f.oldSha], { cwd: f.directory, env: f.gitEnv, stdio: 'ignore' });
  const pinnedCheckout = validateSource(f, { HEAD_SHA: f.oldSha });
  assert.equal(pinnedCheckout.status, 0, pinnedCheckout.stderr);

  const manualMain = validateSource(f, { EVENT_NAME: 'workflow_dispatch', SHA: f.oldSha });
  assert.equal(manualMain.status, 0, manualMain.stderr);
  const manualBranch = validateSource(f, { EVENT_NAME: 'workflow_dispatch', REF: 'refs/heads/release', SHA: f.oldSha });
  assert.notEqual(manualBranch.status, 0);
  const failedCI = validateSource(f, { CONCLUSION: 'failure' });
  assert.notEqual(failedCI.status, 0);
});
