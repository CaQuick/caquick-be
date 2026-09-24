import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 부팅 실패 경보는 AlertService(프로세스 메모리 억제)를 못 쓴다 — 프로세스가 매번 새로 뜬다.
 * 감독자(PM2·compose)가 자동 재시작하면 같은 원인으로 매번 경보가 나가므로, 마지막 전송 시각을 파일에 남겨
 * 같은 호스트에서 창 안에는 한 번만 보낸다. 파일을 못 쓰는 환경이면 보내는 쪽으로 기운다(경보 누락보다 중복이 낫다).
 */
export const BOOT_ALERT_WINDOW_MS = 5 * 60_000;

export function defaultBootAlertStatePath(): string {
  return join(tmpdir(), 'caquick-boot-alert.json');
}

export function shouldSendBootAlert(
  nowMs: number,
  windowMs: number = BOOT_ALERT_WINDOW_MS,
  statePath: string = defaultBootAlertStatePath(),
): boolean {
  let lastSentAt = 0;
  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as {
      lastSentAt?: unknown;
    };
    if (typeof raw.lastSentAt === 'number') lastSentAt = raw.lastSentAt;
  } catch {
    // 없거나 깨진 파일 = 보낸 적 없음
  }
  if (nowMs - lastSentAt < windowMs) return false;
  try {
    mkdirSync(join(statePath, '..'), { recursive: true });
    writeFileSync(statePath, JSON.stringify({ lastSentAt: nowMs }), 'utf8');
  } catch {
    // 기록 실패는 무시 — 이번 경보는 보낸다
  }
  return true;
}
