import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
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
  if (!ensurePrivateDir(stateDir, nowMs)) return true;
  const lockPath = join(stateDir, 'lock');
  if (!acquireLock(lockPath, nowMs)) return false;
  try {
    const statePath = join(stateDir, 'last-sent');
    const lastSentAt = readLastSentAt(statePath, nowMs);
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

/**
 * 디렉터리를 만들고 700을 **강제**한다 — 이미 있던(미리 만들어 둔·bind mount) 디렉터리는 mkdir의 mode가 손대지 않으므로
 * 다른 사용자가 쓸 수 있는 채로 남는다. 내 소유가 아니거나 권한을 못 고치면 억제 파일을 믿지 않는다(호출자가 보낸다).
 */
function ensurePrivateDir(stateDir: string, nowMs: number): boolean {
  try {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const st = statSync(stateDir);
    if (!st.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return false;
    if ((st.mode & 0o077) === 0) return true;
    return repairLooseDir(stateDir, nowMs);
  } catch {
    return false;
  }
}

/**
 * 느슨한 디렉터리의 수리(700 + 남이 심어 둔 상태 삭제)는 **수리 잠금** 아래에서 한 프로세스만 한다. 잠금은 상태 디렉터리
 * 밖(형제 경로)에 둔다 — 안에 두면 수리 대상과 같이 지워진다. 잠금 아래에서 권한을 다시 읽어, 이미 고쳐졌으면 아무것도
 * 지우지 않는다 — 먼저 고친 프로세스가 막 만든 lock·last-sent를 뒤따른 프로세스가 지워 둘 다 보내는 일이 없게.
 */
function repairLooseDir(stateDir: string, nowMs: number): boolean {
  const repairLock = `${stateDir}.repair-lock`;
  if (!acquireLock(repairLock, nowMs)) return false;
  try {
    if ((statSync(stateDir).mode & 0o077) !== 0) {
      chmodSync(stateDir, 0o700);
      for (const name of ['lock', 'last-sent']) {
        try {
          unlinkSync(join(stateDir, name));
        } catch {
          // 없으면 그만
        }
      }
    }
    return true;
  } finally {
    try {
      unlinkSync(repairLock);
    } catch {
      // 이미 없으면 그만
    }
  }
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

/** 내 소유의 일반 파일만 읽는다(링크·남의 파일은 0). 미래 값은 억제를 영구화하므로 무시한다. */
function readLastSentAt(statePath: string, nowMs: number): number {
  try {
    const { O_RDONLY, O_NOFOLLOW } = constants;
    const fd = openSync(statePath, O_RDONLY | O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      const uid = process.getuid?.();
      if (!st.isFile() || (uid !== undefined && st.uid !== uid)) return 0;
      const value = Number(readFileSync(fd, 'utf8'));
      return Number.isFinite(value) && value <= nowMs ? value : 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 0;
  }
}
