import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 부팅 실패 경보는 AlertService(프로세스 메모리 억제)를 못 쓴다 — 프로세스가 매번 새로 뜬다.
 * 감독자(PM2·compose)가 프로세스 여럿을 동시에 재시작하므로 결정은 **호스트 잠금 파일(O_EXCL)** 아래에서 하고,
 * 억제는 마지막 전송 시각 기준 **롤링 창**이다(고정 버킷은 경계에서 ms 차이로 두 번 나간다).
 * 잠금을 못 잡으면(다른 프로세스가 결정 중) 이번 프로세스는 보내지 않는다 — 그쪽이 보낸다.
 * 파일을 못 쓰는 환경이면 보내는 쪽으로 기운다(경보 누락보다 중복이 낫다).
 */
export function defaultBootAlertStateDir(): string {
  return join(tmpdir(), 'caquick-boot-alert');
}

/** 결정은 ms 단위로 끝난다 — 이보다 오래된 잠금은 죽은 프로세스가 남긴 것으로 보고 치운다. */
const STALE_LOCK_MS = 10_000;

export function shouldSendBootAlert(
  nowMs: number,
  windowMs: number,
  stateDir: string = defaultBootAlertStateDir(),
): boolean {
  try {
    mkdirSync(stateDir, { recursive: true });
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
      writeFileSync(statePath, String(nowMs), 'utf8');
    } catch {
      // 기록 실패는 무시 — 이번 경보는 보낸다
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
      try {
        if (nowMs - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue; // 그새 풀렸다 — 다시 시도
      }
      return false;
    }
  }
  return false;
}

function readLastSentAt(statePath: string): number {
  try {
    const value = Number(readFileSync(statePath, 'utf8'));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}
