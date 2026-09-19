import {
  AUDIT_LIBRARY,
  collectAuditViolations,
  collectRecordCalls,
  listAuditSources,
} from '@/test/audit-write-path.helper';
import type { AuditSource } from '@/test/audit-write-path.helper';

// P1-12 완료 기준 게이트: 감사 기록은 ① 라이브러리 1곳에서만 쓰고 ② 항상 도메인 트랜잭션 안에서 부른다.
// 조작만 커밋되고 감사 기록이 빠지는 상태를 코드 수준에서 막는다.
describe('감사 기록 경로 게이트', () => {
  const sources = listAuditSources();
  const violations = collectAuditViolations(sources);
  const recordCalls = collectRecordCalls(sources);

  describe('현재 코드', () => {
    it('검사 대상이 실제로 존재한다(위반 0이 스캔 실패가 아님을 먼저 보인다)', () => {
      expect(sources.length).toBeGreaterThan(500);
      expect(recordCalls.length).toBeGreaterThanOrEqual(30);
    });

    it('감사 테이블 직접 write는 라이브러리 1곳뿐이다', () => {
      const library = sources.find((s) => s.file === AUDIT_LIBRARY);
      expect(library).toBeDefined();
      // 라이브러리를 허용 목록에서 빼면 걸려야 한다 — 검사기가 이 write를 실제로 본다는 증거.
      expect(
        collectAuditViolations([
          {
            file: 'src/features/x/repositories/x.repository.ts',
            text: library!.text,
          },
        ]).filter((v) => v.kind === 'direct-write'),
      ).toHaveLength(1);
      expect(violations.filter((v) => v.kind === 'direct-write')).toEqual([]);
    });

    it('감사 포트 호출은 전부 트랜잭션 클라이언트를 받는다', () => {
      expect(violations.filter((v) => v.kind === 'untx-record')).toEqual([]);
      expect([...new Set(recordCalls.map((c) => c.firstArg))]).toEqual(['tx']);
    });

    it('spec·테스트 하네스는 스캔 대상이 아니다(픽스처 직접 insert 허용)', () => {
      expect(sources.filter((s) => s.file.endsWith('.spec.ts'))).toEqual([]);
      expect(sources.filter((s) => s.file.startsWith('src/test/'))).toEqual([]);
      expect(
        sources.filter((s) => s.file.startsWith('src/generated/')),
      ).toEqual([]);
    });
  });

  // 막아야 할 입력 공간 전수. 새 우회 수법이 나오면 줄을 추가한다.
  describe('반증', () => {
    const feature = (body: string): AuditSource[] => [
      { file: 'src/features/x/repositories/x.repository.ts', text: body },
    ];

    it.each([
      [
        'prisma 직접',
        'await this.prisma.auditLog.create({ data });',
        'direct-write',
      ],
      ['tx 직접', 'await tx.auditLog.create({ data });', 'direct-write'],
      ['updateMany', 'await tx.auditLog.updateMany({ data });', 'direct-write'],
      [
        'deleteMany',
        'await db.auditLog.deleteMany({ where });',
        'direct-write',
      ],
      ['createMany', 'await tx.auditLog.createMany({ data });', 'direct-write'],
      [
        'prisma를 tx 자리에',
        'await this.auditLogs.recordAudit(this.prisma, entry);',
        'untx-record',
      ],
      [
        'prisma 식별자를 tx 자리에',
        'await this.auditLogs.recordAudit(prisma, entry);',
        'untx-record',
      ],
      [
        '옛 시그니처(인자 1개)',
        'await this.auditLogs.recordAudit(entry);',
        'untx-record',
      ],
      [
        '즉석 트랜잭션을 인라인으로',
        'await this.auditLogs.recordAudit(await this.prisma.$transaction(fn), entry);',
        'untx-record',
      ],
    ])('%s 는 걸린다', (_label, body, kind) => {
      const found = collectAuditViolations(feature(body));

      expect(found).toHaveLength(1);
      expect(found[0].kind).toBe(kind);
    });

    it.each([
      ['tx 인자', 'await this.auditLogs.recordAudit(tx, entry);'],
      [
        '이름 있는 tx 인자',
        'await this.auditLogs.recordAudit(orderTx, entry);',
      ],
      ['주석 속 위반', '// await this.prisma.auditLog.create({ data });'],
      ['문자열 속 위반', "const s = 'prisma.auditLog.create(';"],
      ['다른 모델 write', 'await tx.order.create({ data });'],
    ])('%s 는 걸리지 않는다', (_label, body) => {
      expect(collectAuditViolations(feature(body))).toEqual([]);
    });

    it('라이브러리 파일에서는 직접 write가 허용된다', () => {
      expect(
        collectAuditViolations([
          { file: AUDIT_LIBRARY, text: 'await tx.auditLog.create({ data });' },
        ]),
      ).toEqual([]);
    });
  });
});
