// Discord Webhook 알림 라이브러리
// 이벤트 판별 + Discord Embed 메시지 빌드 (순수 함수, I/O 없음)

// ── 색상 상수 ──
const COLORS = {
  PR_MERGED: 0x6f42c1, // 보라
  BRANCH_CREATED: 0x28a745, // 초록
  BRANCH_PUSH: 0x0366d6, // 파랑
  ISSUE_OPENED: 0xd73a49, // 빨강
};

// ── 이벤트 타입 ──

/**
 * GitHub 이벤트를 알림 가능한 이벤트 타입으로 변환한다.
 * 알림 대상이 아니면 null을 반환한다.
 *
 * @param {string} eventName - GitHub event name (e.g. 'pull_request', 'push')
 * @param {Record<string, unknown>} payload - GitHub event payload
 * @returns {'pr_merged' | 'branch_created' | 'branch_push' | 'issue_opened' | null}
 */
export function resolveEventType(eventName, payload) {
  if (eventName === 'pull_request') {
    const pr = payload?.pull_request;
    if (pr?.merged === true) return 'pr_merged';
    return null;
  }

  if (eventName === 'create') {
    if (payload?.ref_type === 'branch') return 'branch_created';
    return null;
  }

  if (eventName === 'push') {
    return 'branch_push';
  }

  if (eventName === 'issues') {
    if (payload?.action === 'opened') return 'issue_opened';
    return null;
  }

  return null;
}

// ── Embed 빌더 ──

/**
 * @typedef {Object} EmbedMeta
 * @property {string} repository - 'owner/repo' 형태
 * @property {string} serverUrl - GitHub 서버 URL (e.g. 'https://github.com')
 */

/**
 * 이벤트 타입에 따라 Discord Embed 객체를 생성한다.
 *
 * @param {'pr_merged' | 'branch_created' | 'branch_push' | 'issue_opened'} eventType
 * @param {Record<string, unknown>} payload
 * @param {EmbedMeta} meta
 * @returns {object} Discord Embed 객체
 */
export function buildEmbed(eventType, payload, meta) {
  switch (eventType) {
    case 'pr_merged':
      return buildPrMergedEmbed(payload, meta);
    case 'branch_created':
      return buildBranchCreatedEmbed(payload, meta);
    case 'branch_push':
      return buildBranchPushEmbed(payload, meta);
    case 'issue_opened':
      return buildIssueOpenedEmbed(payload, meta);
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
}

/**
 * PR 머지 Embed를 생성한다.
 */
export function buildPrMergedEmbed(payload, meta) {
  const pr = payload.pull_request;
  const prNumber = pr.number;
  const prTitle = pr.title;
  const author = pr.user?.login ?? 'unknown';
  const headBranch = pr.head?.ref ?? 'unknown';
  const baseBranch = pr.base?.ref ?? 'unknown';
  const prUrl = pr.html_url ?? `${meta.serverUrl}/${meta.repository}/pull/${prNumber}`;

  return {
    title: `🔀 PR #${prNumber} Merged`,
    description: prTitle,
    color: COLORS.PR_MERGED,
    url: prUrl,
    fields: [
      { name: 'Repository', value: meta.repository, inline: true },
      { name: 'Author', value: `@${author}`, inline: true },
      { name: 'Branch', value: `\`${headBranch}\` → \`${baseBranch}\``, inline: false },
    ],
    timestamp: new Date().toISOString(),
  };
}

/**
 * 브랜치 생성 Embed를 생성한다.
 */
export function buildBranchCreatedEmbed(payload, meta) {
  const branchName = payload.ref;
  const author = payload.sender?.login ?? 'unknown';
  const branchUrl = `${meta.serverUrl}/${meta.repository}/tree/${branchName}`;

  return {
    title: '🌿 New Branch Created',
    description: `\`${branchName}\``,
    color: COLORS.BRANCH_CREATED,
    url: branchUrl,
    fields: [
      { name: 'Repository', value: meta.repository, inline: true },
      { name: 'Author', value: `@${author}`, inline: true },
    ],
    timestamp: new Date().toISOString(),
  };
}

/**
 * 브랜치 푸시 Embed를 생성한다.
 */
export function buildBranchPushEmbed(payload, meta) {
  const ref = payload.ref ?? '';
  const branchName = ref.replace(/^refs\/heads\//, '');
  const author = payload.sender?.login ?? 'unknown';
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  const commitCount = commits.length;
  const compareUrl = payload.compare ?? `${meta.serverUrl}/${meta.repository}`;

  const repoUrl = `${meta.serverUrl}/${meta.repository}`;
  const commitLines = commits
    .slice(0, 5)
    .map((c) => {
      const sha = (c.id ?? '').slice(0, 7);
      const commitUrl = `${repoUrl}/commit/${c.id}`;
      const msg = truncate(c.message?.split('\n')[0] ?? '', 60);
      return `[\`${sha}\`](${commitUrl}) ${msg}`;
    });

  if (commits.length > 5) {
    commitLines.push(`... and ${commits.length - 5} more`);
  }

  const fields = [
    { name: 'Repository', value: meta.repository, inline: true },
    { name: 'Author', value: `@${author}`, inline: true },
  ];

  if (commitLines.length > 0) {
    fields.push({ name: 'Commits', value: commitLines.join('\n'), inline: false });
  }

  return {
    title: `📦 Push to ${branchName}`,
    description: `${commitCount} commit(s) pushed`,
    color: COLORS.BRANCH_PUSH,
    url: compareUrl,
    fields,
    timestamp: new Date().toISOString(),
  };
}

/**
 * 이슈 생성 Embed를 생성한다.
 */
export function buildIssueOpenedEmbed(payload, meta) {
  const issue = payload.issue;
  const issueNumber = issue.number;
  const issueTitle = issue.title;
  const author = issue.user?.login ?? 'unknown';
  const issueUrl = issue.html_url ?? `${meta.serverUrl}/${meta.repository}/issues/${issueNumber}`;
  const labels = Array.isArray(issue.labels) ? issue.labels : [];

  const fields = [
    { name: 'Repository', value: meta.repository, inline: true },
    { name: 'Author', value: `@${author}`, inline: true },
  ];

  if (labels.length > 0) {
    const labelNames = labels.map((l) => l.name).filter(Boolean).join(', ');
    if (labelNames) {
      fields.push({ name: 'Labels', value: labelNames, inline: false });
    }
  }

  return {
    title: `📋 New Issue #${issueNumber}`,
    description: issueTitle,
    color: COLORS.ISSUE_OPENED,
    url: issueUrl,
    fields,
    timestamp: new Date().toISOString(),
  };
}

// ── Webhook body ──

/**
 * Discord webhook 요청 body를 생성한다.
 *
 * @param {object} embed - Discord Embed 객체
 * @returns {{ embeds: object[] }}
 */
export function buildWebhookBody(embed) {
  return { embeds: [embed] };
}

// ── 유틸 ──

/**
 * 문자열을 최대 길이로 자른다.
 *
 * @param {string} str
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(str, maxLength) {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
