import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * 부팅 실패 경보는 AlertService(프로세스 메모리 억제)를 못 쓴다 — 프로세스가 매번 새로 뜬다.
 * 감독자(PM2·compose)가 프로세스 여럿을 동시에 재시작하므로 결정은 **호스트 잠금 파일(O_EXCL)** 아래에서 하고,
 * 억제는 마지막 전송 시각 기준 **롤링 창**이다(고정 버킷은 경계에서 ms 차이로 두 번 나간다).
 * 잠금을 못 잡으면(다른 프로세스가 결정 중) 이번 프로세스는 보내지 않는다 — 그쪽이 보낸다.
 * 파일을 못 쓰는 환경이면 보내는 쪽으로 기운다(경보 누락보다 중복이 낫다).
 *
 * 상태 디렉터리는 공유 tmp가 아니라 실행 사용자의 홈 아래(700)다 — tmp의 고정 경로는 다른 로컬 사용자가 먼저 만들거나
 * 심볼릭 링크를 심을 수 있다(CodeQL insecure-temporary-file). 상태 파일은 O_NOFOLLOW로 열어 링크를 따라가지 않는다.
 */
export function defaultBootAlertStateDir(): string {
  const fromEnv = process.env.BOOT_ALERT_STATE_DIR?.trim();
  return fromEnv || join(homedir(), '.caquick', 'boot-alert');
}

/** 결정은 ms 단위로 끝난다 — 이보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 보고 치운다. */
const STALE_LOCK_MS = 10_000;

export function shouldSendBootAlert(
  nowMs: number,
  windowMs: number,
  stateDir: string = defaultBootAlertStateDir(),
): boolean {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  } catch {
    return true;
  }
  const lockPath = join(stateDir, 'lock');
  if (!acquireLock(lockPath, nowMs)) return false;
  try {
    const statePath = join(stateDir, 'last-sent');
    const lastSentAt = readLastSentAt(statePath);
    if (nowMs - lastSentAt < windowMs) return false;
    try {
      writeStateNoFollow(statePath, String(nowMs));
    } catch {
      // 기록 실패(링크가 심겨 있거나 못 쓰는 환경)는 무시 — 이번 경보는 보낸다
    }
    return true;
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // 이미 없으면 그만
    }
  }
}

function acquireLock(lockPath: string, nowMs: number): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return true; // 잠금 자체를 못 쓰는 환경
      if (!reclaimStaleLock(lockPath, nowMs)) return false;
    }
  }
  return false;
}

/**
 * 오래된 잠금은 unlink가 아니라 **rename으로 가져간다** — rename은 원자적이라 여럿이 동시에 발견해도 한 프로세스만
 * 성공하고, 그 사이 다른 프로세스가 새로 만든 잠금을 지우는 일이 없다. 성공한 쪽만 다시 잠금을 시도한다.
 */
function reclaimStaleLock(lockPath: string, nowMs: number): boolean {
  try {
    if (nowMs - statSync(lockPath).mtimeMs <= STALE_LOCK_MS) return false;
  } catch {
    return true; // 그새 풀렸다 — 다시 시도
  }
  const taken = `${lockPath}.stale.${process.pid}`;
  try {
    renameSync(lockPath, taken);
  } catch {
    return false; // 다른 프로세스가 먼저 가져갔다
  }
  try {
    unlinkSync(taken);
  } catch {
    // 남아도 무해
  }
  return true;
}

/** 심볼릭 링크면 열기가 실패한다 — 링크 대상 파일을 덮어쓰지 않는다. */
function writeStateNoFollow(statePath: string, value: string): void {
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = constants;
  const fd = openSync(
    statePath,
    O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, value);
  } finally {
    closeSync(fd);
  }
}

function readLastSentAt(statePath: string): number {
  try {
    const value = Number(readFileSync(statePath, 'utf8'));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
