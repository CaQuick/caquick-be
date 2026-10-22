/**
 * 2차 지역 중심 좌표 채우기.
 *
 * 입력·출력: prisma/seed/data/regions.generated.json — 좌표가 없는 2차 항목만 카카오 주소 검색의 시군구 대표점으로 채운다.
 *  - 받은 좌표를 coord2regioncode로 되돌려 같은 시군구인지 확인한다. 하나라도 어긋나면 파일을 쓰지 않고 멈춘다.
 *  - --sql <경로>: 이미 지역이 있는 DB를 채우는 데이터 마이그레이션 SQL을 JSON의 좌표 전체로 쓴다.
 *
 * 실행: OIDC_KAKAO_CLIENT_ID=<카카오 REST 키> npx ts-node scripts/fill-region-centers.ts [--sql <migration.sql>]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const JSON_PATH = join(
  process.cwd(),
  'prisma/seed/data/regions.generated.json',
);
const SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/address.json';
const REVERSE_URL = 'https://dapi.kakao.com/v2/local/geo/coord2regioncode.json';

const SIDO_BY_CODE: Record<string, string> = {
  '11': '서울특별시',
  '28': '인천광역시',
  '41': '경기도',
};

interface Level2 {
  slug: string;
  name: string;
  parentSlug: string;
  sigunguCode: string;
  sortOrder: number;
  centerLat?: string;
  centerLng?: string;
}

interface KakaoDocument {
  address_type?: string;
  region_type?: string;
  code?: string;
  x: string;
  y: string;
}

interface RegionSeedFile {
  level1: unknown[];
  level2: Level2[];
}

async function kakao(
  url: string,
  params: Record<string, string>,
  key: string,
): Promise<{ documents: KakaoDocument[] }> {
  const res = await fetch(`${url}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `KakaoAK ${key}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`[region-centers] 카카오 ${res.status}: ${url}`);
  return (await res.json()) as { documents: KakaoDocument[] };
}

/** "수원시영통구"처럼 붙어 있는 일반시의 구는 띄워야 카카오가 시군구로 찾는다. */
function queryOf(region: Level2): string {
  const sido = SIDO_BY_CODE[region.sigunguCode.slice(0, 2)];
  if (!sido) throw new Error(`[region-centers] 시도 미상: ${region.slug}`);
  return `${sido} ${region.name.replace(/^(.+시)(.+구)$/, '$1 $2')}`;
}

async function centerOf(
  region: Level2,
  key: string,
): Promise<{ lat: string; lng: string } | string> {
  const query = queryOf(region);
  const { documents } = await kakao(SEARCH_URL, { query }, key);
  if (documents.length !== 1 || documents[0].address_type !== 'REGION') {
    return `'${query}' 검색 결과가 시군구 1건이 아니다(${documents.length}건)`;
  }
  const [{ x, y }] = documents;
  const reverse = await kakao(REVERSE_URL, { x, y }, key);
  const code = reverse.documents.find((d) => d.region_type === 'B')?.code;
  if (code?.slice(0, 5) !== region.sigunguCode) {
    return `'${query}' 좌표(${y}, ${x})가 다른 시군구(${code ?? '없음'})에 있다`;
  }
  // 컬럼이 DECIMAL(10,7)이다
  return { lat: Number(y).toFixed(7), lng: Number(x).toFixed(7) };
}

function migrationSql(regions: Level2[]): string {
  const rows = regions
    .filter((r) => r.centerLat !== undefined && r.centerLng !== undefined)
    .map((r, i) =>
      i === 0
        ? `    SELECT '${r.slug}' AS \`slug\`, ${r.centerLat} AS \`lat\`, ${r.centerLng} AS \`lng\``
        : `    UNION ALL SELECT '${r.slug}', ${r.centerLat}, ${r.centerLng}`,
    );
  return `-- 2차 지역 중심 좌표(카카오 주소 검색의 시군구 대표점). 시드(regions.generated.json)와 같은 값이며 scripts/fill-region-centers.ts가 만든다.
-- 좌표가 비어 있는 행만 채워 관리자가 넣은 값은 그대로 둔다. 지역이 없는 빈 DB에서는 아무 행도 건드리지 않는다.
UPDATE \`region\` r
JOIN (
${rows.join('\n')}
) c ON c.\`slug\` = r.\`slug\`
SET r.\`center_lat\` = c.\`lat\`, r.\`center_lng\` = c.\`lng\`, r.\`updated_at\` = CURRENT_TIMESTAMP(3)
WHERE r.\`level\` = 2 AND r.\`center_lat\` IS NULL AND r.\`center_lng\` IS NULL;
`;
}

async function main(): Promise<void> {
  const key = process.env.OIDC_KAKAO_CLIENT_ID;
  if (!key) throw new Error('[region-centers] OIDC_KAKAO_CLIENT_ID가 필요하다');
  const sqlAt = process.argv.indexOf('--sql');
  const sqlPath = sqlAt >= 0 ? process.argv[sqlAt + 1] : undefined;

  const data = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as RegionSeedFile;
  const targets = data.level2.filter(
    (r) => r.centerLat === undefined || r.centerLng === undefined,
  );
  console.log(`2차 ${data.level2.length}건 중 채울 대상 ${targets.length}건`);

  const failures: string[] = [];
  for (const region of targets) {
    const center = await centerOf(region, key);
    if (typeof center === 'string') {
      failures.push(`${region.slug}: ${center}`);
      continue;
    }
    region.centerLat = center.lat;
    region.centerLng = center.lng;
  }
  if (failures.length > 0) {
    console.error(failures.join('\n'));
    throw new Error(
      `[region-centers] ${failures.length}건 실패 — 파일을 쓰지 않았다`,
    );
  }
  console.log(`역검증 통과 ${targets.length}/${targets.length}`);

  writeFileSync(JSON_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  if (sqlPath) writeFileSync(sqlPath, migrationSql(data.level2), 'utf8');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
