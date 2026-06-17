/**
 * 지역(Region) 시드 데이터 생성기.
 *
 * 입력: 공공데이터포털 "국토교통부_전국 법정동" CSV (gitignored, prisma/seed/data/)
 * 출력: prisma/seed/data/regions.generated.json (커밋 대상 — 시드 재현 소스)
 *
 * 규칙:
 *  - 수도권(서울/인천/경기)의 "활성(삭제일자 없음)" 법정동만 사용
 *  - 2차 지역 = 동(洞)을 직접 보유한 표준 시군구 (경기 일반시는 구 단위: 수원시영통구 등)
 *  - 1차 배정: 서울=한강 북/남, 경기=경기북부청 관할 기준 북/남, 인천=단일
 *
 * 1차 그룹 경계는 운영 정의이므로, 변경 시 이 파일의 SEOUL_NORTH / GYEONGGI_NORTH_CITY 를
 * 고치고 재실행한다. (figma spec에 2차 생활권 큐레이션이 확정되면 별도 반영)
 *
 * 실행: npx ts-node scripts/generate-region-seed.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CSV_PATH = join(
  process.cwd(),
  'prisma/seed/data/국토교통부_전국 법정동_20260609.csv',
);
const OUT_PATH = join(process.cwd(), 'prisma/seed/data/regions.generated.json');

const CAPITAL_SIDO: readonly string[] = ['서울특별시', '인천광역시', '경기도'];

// 서울 한강 이북 14개 구 → 서울 북부. 나머지 11개 구는 서울 남부.
const SEOUL_NORTH = new Set<string>([
  '종로구',
  '중구',
  '용산구',
  '성동구',
  '광진구',
  '동대문구',
  '중랑구',
  '성북구',
  '강북구',
  '도봉구',
  '노원구',
  '은평구',
  '서대문구',
  '마포구',
]);

// 경기북부청 관할 10개 시·군 → 경기 북부. 나머지는 경기 남부.
const GYEONGGI_NORTH_CITY = new Set<string>([
  '고양시',
  '의정부시',
  '남양주시',
  '파주시',
  '구리시',
  '포천시',
  '양주시',
  '동두천시',
  '가평군',
  '연천군',
]);

interface Level1 {
  slug: string;
  name: string;
  sortOrder: number;
}

interface Level2 {
  slug: string;
  name: string;
  parentSlug: string;
  sigunguCode: string;
  sortOrder: number;
}

// figma spec 순서: 전국 / 서울 북부 / 서울 남부 / 경기 북부 / 경기 남부 / 인천
const LEVEL1: Level1[] = [
  { slug: 'nationwide', name: '전국', sortOrder: 0 },
  { slug: 'seoul-north', name: '서울 북부', sortOrder: 1 },
  { slug: 'seoul-south', name: '서울 남부', sortOrder: 2 },
  { slug: 'gyeonggi-north', name: '경기 북부', sortOrder: 3 },
  { slug: 'gyeonggi-south', name: '경기 남부', sortOrder: 4 },
  { slug: 'incheon', name: '인천', sortOrder: 5 },
];

function parentSlugOf(sido: string, sigungu: string): string {
  if (sido === '인천광역시') return 'incheon';
  if (sido === '서울특별시') {
    return SEOUL_NORTH.has(sigungu) ? 'seoul-north' : 'seoul-south';
  }
  // 경기도: "수원시영통구" → "수원시", "가평군" → "가평군" 으로 시/군 단위 추출
  const cityMatch = sigungu.match(/^(.+?[시군])/);
  const city = cityMatch ? cityMatch[1] : sigungu;
  return GYEONGGI_NORTH_CITY.has(city) ? 'gyeonggi-north' : 'gyeonggi-south';
}

interface Sigungu {
  sido: string;
  sigungu: string;
  code5: string;
}

function main(): void {
  const text = readFileSync(CSV_PATH, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);

  // code5(시도2+시군구3) 기준 distinct. "동을 직접 보유한 시군구"만 채택.
  const seen = new Map<string, Sigungu>();

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 8) continue;

    const code = cols[0];
    const sido = cols[1];
    const sigungu = cols[2];
    const deletedAt = cols[7];

    if (deletedAt && deletedAt.trim()) continue; // 폐지 제외
    if (!CAPITAL_SIDO.includes(sido)) continue; // 수도권만
    if (!sigungu) continue;

    // 법정동코드 10자리 = 시도2 + 시군구3 + 읍면동3 + 리2
    const sigunguPart = code.slice(2, 5);
    const eupmyeonPart = code.slice(5, 8);
    const riPart = code.slice(8, 10);

    if (sigunguPart === '000') continue; // 시도 레벨 제외
    if (eupmyeonPart === '000') continue; // 시군구 레벨 제외 (동 미보유 상위 '수원시')
    if (riPart !== '00') continue; // 리 레벨 제외

    const code5 = code.slice(0, 5);
    if (!seen.has(code5)) seen.set(code5, { sido, sigungu, code5 });
  }

  const sigungus = [...seen.values()].sort((a, b) =>
    a.code5.localeCompare(b.code5),
  );

  const level2: Level2[] = sigungus.map((s, idx) => ({
    slug: `sgg-${s.code5}`,
    name: s.sigungu,
    parentSlug: parentSlugOf(s.sido, s.sigungu),
    sigunguCode: s.code5,
    sortOrder: idx,
  }));

  const out = {
    generatedFrom: '국토교통부_전국 법정동_20260609.csv',
    note: '수도권(서울/인천/경기) 활성 시군구. 2차=동 보유 표준 시군구. 1차 배정: 서울=한강 북/남, 경기=경기북부청 기준, 인천=단일.',
    level1: LEVEL1,
    level2,
  };

  writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  // 검증 출력
  const byParent: Record<string, number> = {};
  for (const r of level2)
    byParent[r.parentSlug] = (byParent[r.parentSlug] ?? 0) + 1;

  console.log('총 2차 시군구:', level2.length);

  console.log('1차별 2차 수:', byParent);
}

main();
