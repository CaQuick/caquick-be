import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * 부팅 실패 경보는 AlertService(프로세스 메모리 억제)를 못 쓴다 — 프로세스가 매번 새로 뜬다.
 * 감독자(PM2·compose)가 프로세스 여럿을 동시에 재시작하므로 결정은 **호스트 잠금 파일(O_EXCL)** 아래에서 하고,
 * 억제는 마지막 전송 시각 기준 **롤링 창**이다(고정 버킷은 경계에서 ms 차이로 두 번 나간다).
 * 잠금을 못 잡으면(다른 프로세스가 결정 중) 이번 프로세스는 보내지 않는다 — 그쪽이 보낸다.
 * 파일을 못 쓰는 환경이면 보내는 쪽으로 기운다(경보 누락보다 중복이 낫다).
 *
 * 상태 디렉터리는 공유 tmp가 아니라 실행 사용자의 홈 아래(700)다 — tmp의 고정 경로는 다른 로컬 사용자가 먼저 만들거나
 * 심볼릭 링크를 심을 수 있다(CodeQL insecure-temporary-file). 남이 만들었거나 바꿔치기할 수 있는 디렉터리는 믿지 않고
 * 억제 없이 보내며, 그 안의 파일은 소유자·종류·시각으로 걸러 심어 둔 값이 억제를 조작하지 못하게 한다.
 */
export function defaultBootAlertStateDir(): string {
  const fromEnv = process.env.BOOT_ALERT_STATE_DIR?.trim();
  return fromEnv || join(homedir(), '.caquick', 'boot-alert');
}

/**
 * 결정은 ms 단위로 끝난다 — 이보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 보고 치운다.
 * 시각 비교의 여유이기도 하다: 동시에 뜬 프로세스끼리 nowMs가 몇 ms 어긋나고, 방금 만든 파일의 mtime은 반올림으로 살짝 앞선다.
 */
const STALE_LOCK_MS = 10_000;

export function shouldSendBootAlert(
  nowMs: number,
  windowMs: number,
  stateDir: string = defaultBootAlertStateDir(),
): boolean {
  if (!ensurePrivateDir(stateDir)) return true;
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
    const st = lstatSync(lockPath);
    // 우리가 만드는 잠금은 빈 일반 파일이고 mtime은 지금 언저리다 — 디렉터리·링크·먼 미래 mtime은 심어 둔 것이라 stale로 본다
    if (st.isFile() && Math.abs(nowMs - st.mtimeMs) <= STALE_LOCK_MS)
      return false;
  } catch {
    return true; // 그새 풀렸다 — 다시 시도
  }
  const taken = `${lockPath}.stale.${process.pid}`;
  try {
    renameSync(lockPath, taken);
  } catch {
    return false; // 다른 프로세스가 먼저 가져갔다
  }
  rmSync(taken, { recursive: true, force: true });
  return true;
}

/**
 * 상태 디렉터리를 만들고 믿을 수 있는지 본다. 믿지 않는 경우(호출자는 억제 없이 보낸다):
 * - 부모를 남이 쓸 수 있고 sticky가 아니다 — 검사 뒤에 디렉터리를 통째로 링크로 바꿔치기할 수 있다
 * - 경로가 디렉터리가 아니거나(링크 포함 — lstat) 내 소유가 아니다
 * 이미 있던 디렉터리는 mkdir의 mode가 손대지 않으므로 남이 쓸 수 있으면 700으로 고친다 — chmod는 멱등이라 동시에 해도
 * 안전하고, 그동안 심어 둔 항목은 지우지 않아도 소유자·종류·시각 검사(readLastSentAt·reclaimStaleLock)에 걸러진다.
 * 지우는 수리는 두지 않는다 — 수리 잠금·삭제 순서·회수 경쟁이 전부 억제 중복의 구멍이 됐다.
 */
function ensurePrivateDir(stateDir: string): boolean {
  try {
    // 부모가 없으면(새 설치의 ~/.caquick) 700으로 만들어 쓴다. 있으면 만들기 전에 검사한다 — 남의 디렉터리 아래에 흔적을 남기지 않게
    const parent = lstatParentOrCreate(stateDir);
    if (isWritableByOthers(parent.mode) && (parent.mode & 0o1000) === 0)
      return false;
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const st = lstatSync(stateDir);
    if (!st.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && st.uid !== uid) return false;
    if (isWritableByOthers(st.mode)) chmodSync(stateDir, 0o700);
    return true;
  } catch {
    return false;
  }
}

function lstatParentOrCreate(stateDir: string): Stats {
  const parent = dirname(stateDir);
  try {
    return lstatSync(parent);
  } catch {
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    return lstatSync(parent);
  }
}

/** 위협은 다른 사용자의 **쓰기**다(lock·last-sent 교체). 읽기 비트는 문제가 아니라 기본 755 디렉터리를 고치지 않는다. */
function isWritableByOthers(mode: number): boolean {
  return (mode & 0o022) !== 0;
}

/**
 * 내 소유의 일반 파일에만 쓴다. 남이 심어 둔 것(링크·디렉터리·남의 파일)이 있으면 그 항목을 지우고 새로 만든다 — 링크는 따라가지
 * 않으니 대상은 무사하고, 남의 파일을 truncate만 하면 소유가 남아 영영 읽히지 않는다(부팅 루프마다 경보). 잠금 아래라 우리끼리는 경쟁하지 않는다.
 */
function writeStateNoFollow(statePath: string, value: string): void {
  if (!isOwnRegularFile(statePath))
    rmSync(statePath, { recursive: true, force: true });
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

function isOwnRegularFile(path: string): boolean {
  try {
    const st = lstatSync(path);
    const uid = process.getuid?.();
    return st.isFile() && (uid === undefined || st.uid === uid);
  } catch {
    return true; // 없으면 새로 만들면 된다
  }
}

/** 내 소유의 일반 파일만 읽는다(링크·남의 파일은 0). 먼 미래 값은 억제를 영구화하므로 무시한다. */
function readLastSentAt(statePath: string, nowMs: number): number {
  try {
    const { O_RDONLY, O_NOFOLLOW } = constants;
    const fd = openSync(statePath, O_RDONLY | O_NOFOLLOW);
    try {
      const st = fstatSync(fd);
      const uid = process.getuid?.();
      if (!st.isFile() || (uid !== undefined && st.uid !== uid)) return 0;
      const value = Number(readFileSync(fd, 'utf8'));
      return Number.isFinite(value) && value - nowMs <= STALE_LOCK_MS
        ? value
        : 0;
    } finally {
      closeSync(fd);
    }
  } catch {
    return 0;
  }
}
