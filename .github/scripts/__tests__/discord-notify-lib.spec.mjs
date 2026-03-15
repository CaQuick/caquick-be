import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEventType,
  buildEmbed,
  buildPrMergedEmbed,
  buildBranchCreatedEmbed,
  buildBranchPushEmbed,
  buildIssueOpenedEmbed,
  buildWebhookBody,
} from '../discord-notify-lib.mjs';

const META = { repository: 'CaQuick/caquick-be', serverUrl: 'https://github.com' };

// ── resolveEventType ──

test('pull_request closed + merged=true → pr_merged', () => {
  const payload = { pull_request: { merged: true } };
  assert.equal(resolveEventType('pull_request', payload), 'pr_merged');
});

test('pull_request closed + merged=false → null', () => {
  const payload = { pull_request: { merged: false } };
  assert.equal(resolveEventType('pull_request', payload), null);
});

test('create + ref_type=branch → branch_created', () => {
  const payload = { ref_type: 'branch' };
  assert.equal(resolveEventType('create', payload), 'branch_created');
});

test('create + ref_type=tag → null', () => {
  const payload = { ref_type: 'tag' };
  assert.equal(resolveEventType('create', payload), null);
});

test('push → branch_push', () => {
  assert.equal(resolveEventType('push', {}), 'branch_push');
});

test('issues + action=opened → issue_opened', () => {
  const payload = { action: 'opened' };
  assert.equal(resolveEventType('issues', payload), 'issue_opened');
});

test('issues + action=closed → null', () => {
  const payload = { action: 'closed' };
  assert.equal(resolveEventType('issues', payload), null);
});

test('unknown event → null', () => {
  assert.equal(resolveEventType('deployment', {}), null);
});

// ── buildPrMergedEmbed ──

test('PR 머지 Embed가 올바른 색상과 필드를 갖는다', () => {
  const payload = {
    pull_request: {
      number: 42,
      title: 'feat: 로그인 기능 추가',
      user: { login: 'chado' },
      head: { ref: 'feature/login' },
      base: { ref: 'main' },
      html_url: 'https://github.com/CaQuick/caquick-be/pull/42',
    },
  };

  const embed = buildPrMergedEmbed(payload, META);

  assert.equal(embed.title, '🔀 PR #42 Merged');
  assert.equal(embed.description, 'feat: 로그인 기능 추가');
  assert.equal(embed.color, 0x6f42c1);
  assert.equal(embed.url, 'https://github.com/CaQuick/caquick-be/pull/42');
  assert.equal(embed.fields.length, 3);
  assert.equal(embed.fields[0].value, '[CaQuick/caquick-be](https://github.com/CaQuick/caquick-be)');
  assert.equal(embed.fields[1].value, '[@chado](https://github.com/chado)');
  assert.equal(embed.fields[2].value, '`feature/login` → `main`');
});

// ── buildBranchCreatedEmbed ──

test('브랜치 생성 Embed가 올바른 색상과 필드를 갖는다', () => {
  const payload = {
    ref: 'feature/discord-notify',
    ref_type: 'branch',
    sender: { login: 'chado' },
  };

  const embed = buildBranchCreatedEmbed(payload, META);

  assert.equal(embed.title, '🌿 New Branch Created');
  assert.equal(embed.description, '`feature/discord-notify`');
  assert.equal(embed.color, 0x28a745);
  assert.ok(embed.url.includes('feature/discord-notify'));
  assert.equal(embed.fields.length, 2);
});

// ── buildBranchPushEmbed ──

test('브랜치 푸시 Embed가 올바른 색상과 커밋 목록을 갖는다', () => {
  const payload = {
    ref: 'refs/heads/feature/discord-notify',
    sender: { login: 'chado' },
    compare: 'https://github.com/CaQuick/caquick-be/compare/abc...def',
    commits: [
      { id: 'abc1234567890', message: 'feat: 웹훅 스크립트 추가' },
      { id: 'def5678901234', message: 'test: 테스트 추가' },
      { id: 'ghi9012345678', message: 'fix: 오타 수정' },
    ],
  };

  const embed = buildBranchPushEmbed(payload, META);

  assert.equal(embed.title, '📦 Push to feature/discord-notify');
  assert.equal(embed.description, '3 commit(s) pushed');
  assert.equal(embed.color, 0x0366d6);
  assert.equal(embed.fields.length, 3); // Repository, Author, Commits

  const commitsField = embed.fields[2];
  assert.equal(commitsField.name, 'Commits');
  assert.ok(commitsField.value.includes('[`abc1234`]'));
  assert.ok(commitsField.value.includes('/commit/abc1234567890'));
  assert.ok(commitsField.value.includes('웹훅 스크립트 추가'));
});

test('커밋이 5개를 초과하면 나머지는 요약된다', () => {
  const commits = Array.from({ length: 7 }, (_, i) => ({
    id: `sha${i}0000000000`,
    message: `commit ${i}`,
  }));

  const payload = {
    ref: 'refs/heads/main',
    sender: { login: 'chado' },
    commits,
  };

  const embed = buildBranchPushEmbed(payload, META);
  const commitsField = embed.fields.find((f) => f.name === 'Commits');

  assert.ok(commitsField.value.includes('... and 2 more'));
});

test('커밋이 없는 push도 정상 처리된다', () => {
  const payload = {
    ref: 'refs/heads/main',
    sender: { login: 'chado' },
    commits: [],
  };

  const embed = buildBranchPushEmbed(payload, META);

  assert.equal(embed.description, '0 commit(s) pushed');
  assert.equal(embed.fields.length, 2); // Commits 필드 없음
});

// ── buildIssueOpenedEmbed ──

test('이슈 생성 Embed가 올바른 색상과 필드를 갖는다', () => {
  const payload = {
    action: 'opened',
    issue: {
      number: 45,
      title: '로그인 시 세션 만료 처리 안 됨',
      user: { login: 'chado' },
      html_url: 'https://github.com/CaQuick/caquick-be/issues/45',
      labels: [{ name: 'bug' }, { name: 'auth' }],
    },
  };

  const embed = buildIssueOpenedEmbed(payload, META);

  assert.equal(embed.title, '📋 New Issue #45');
  assert.equal(embed.description, '로그인 시 세션 만료 처리 안 됨');
  assert.equal(embed.color, 0xd73a49);
  assert.equal(embed.fields.length, 3); // Repository, Author, Labels

  const labelsField = embed.fields[2];
  assert.equal(labelsField.name, 'Labels');
  assert.equal(labelsField.value, 'bug, auth');
});

test('라벨이 없는 이슈는 Labels 필드가 없다', () => {
  const payload = {
    action: 'opened',
    issue: {
      number: 46,
      title: '기능 요청',
      user: { login: 'chado' },
      html_url: 'https://github.com/CaQuick/caquick-be/issues/46',
      labels: [],
    },
  };

  const embed = buildIssueOpenedEmbed(payload, META);

  assert.equal(embed.fields.length, 2); // Labels 필드 없음
});

// ── buildEmbed ──

test('buildEmbed가 이벤트 타입에 따라 올바른 빌더를 호출한다', () => {
  const prPayload = {
    pull_request: {
      number: 1,
      title: 'test',
      user: { login: 'user' },
      head: { ref: 'a' },
      base: { ref: 'b' },
    },
  };

  const embed = buildEmbed('pr_merged', prPayload, META);
  assert.equal(embed.color, 0x6f42c1);
});

test('buildEmbed에 알 수 없는 이벤트 타입을 전달하면 에러가 발생한다', () => {
  assert.throws(() => buildEmbed('unknown', {}, META), /Unknown event type/);
});

// ── buildWebhookBody ──

test('buildWebhookBody가 embed를 embeds 배열로 감싼다', () => {
  const embed = { title: 'test', color: 0x000000 };
  const body = buildWebhookBody(embed);

  assert.deepEqual(body, { embeds: [{ title: 'test', color: 0x000000 }] });
});
