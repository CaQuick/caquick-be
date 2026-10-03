-- 2026-07-01 인천 행정체제 개편: 중구·동구·서구(28110·28140·28260) 말소, 제물포구·영종구·서해구·검단구(28125·28155·28275·28290) 신설.
-- 시드(regions.generated.json)는 새 체계로 다시 만들었다. 이 마이그레이션은 이미 지역·매장이 있는 DB를 같은 상태로 맞춘다.
-- 상위 'incheon'이 없는 빈 DB(테스트 컨테이너·새 환경)에서는 아무 행도 건드리지 않는다. 다시 실행해도 결과가 같다.

-- 신설 구. 시드와 같은 slug·값이라 이후 시드 upsert와 어긋나지 않는다
INSERT INTO `region` (`parent_id`, `level`, `name`, `slug`, `sort_order`, `is_active`, `updated_at`)
SELECT p.`id`, 2, n.`name`, n.`slug`, n.`sort_order`, true, CURRENT_TIMESTAMP(3)
FROM `region` p
JOIN (
    SELECT '제물포구' AS `name`, 'sgg-28125' AS `slug`, 25 AS `sort_order`
    UNION ALL SELECT '영종구', 'sgg-28155', 26
    UNION ALL SELECT '서해구', 'sgg-28275', 32
    UNION ALL SELECT '검단구', 'sgg-28290', 33
) n
WHERE p.`slug` = 'incheon' AND p.`level` = 1
ON DUPLICATE KEY UPDATE
    `parent_id` = VALUES(`parent_id`),
    `level` = 2,
    `name` = VALUES(`name`),
    `sort_order` = VALUES(`sort_order`),
    `is_active` = true,
    `deleted_at` = NULL,
    `updated_at` = CURRENT_TIMESTAMP(3);

-- 인천 2차의 노출 순서를 새 시드 값으로 맞춘다(강화군·옹진군만 실제로 바뀐다)
UPDATE `region` r
JOIN (
    SELECT 'sgg-28177' AS `slug`, 27 AS `sort_order`
    UNION ALL SELECT 'sgg-28185', 28
    UNION ALL SELECT 'sgg-28200', 29
    UNION ALL SELECT 'sgg-28237', 30
    UNION ALL SELECT 'sgg-28245', 31
    UNION ALL SELECT 'sgg-28710', 34
    UNION ALL SELECT 'sgg-28720', 35
) o ON o.`slug` = r.`slug`
SET r.`sort_order` = o.`sort_order`, r.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE r.`sort_order` <> o.`sort_order`;

-- 옛 구에 연결된 매장(삭제 포함)을 승계 구로 옮긴다. 동구는 전부 제물포구로 갔다.
-- 중구·서구는 둘로 갈라졌다 — 떨어져 나간 영종구·검단구의 동(법정동·행정동)이면 그쪽, 아니면 남은 쪽(제물포구·서해구).
-- 동 판정은 address_neighborhood 일치를 먼저 보고, 없으면 address_full에서 동 이름을 찾는다(도로명 주소의 괄호 표기 포함).
-- 시천동·오류동(행정동 오류왕길동)은 아라뱃길 남측 필지가 검암동·경서동(서해구)으로 넘어가 이름만으로 정할 수 없다 — 옮기지 않는다
UPDATE `store` s
JOIN `region` o ON o.`id` = s.`region_id` AND o.`slug` IN ('sgg-28110', 'sgg-28140', 'sgg-28260')
JOIN `region` n ON n.`slug` = CASE
    WHEN o.`slug` = 'sgg-28140' THEN 'sgg-28125'
    WHEN o.`slug` = 'sgg-28110' THEN
        CASE WHEN TRIM(s.`address_neighborhood`) IN (
                '중산동', '운남동', '운서동', '운북동', '을왕동', '남북동', '덕교동', '무의동',
                '영종동', '영종1동', '영종2동', '운서1동', '운서2동', '용유동'
            )
            OR s.`address_full` REGEXP '(^|[ (])(중산동|운남동|운서동|운북동|을왕동|남북동|덕교동|무의동|영종동|영종1동|영종2동|운서1동|운서2동|용유동)([ ),]|$)'
        THEN 'sgg-28155' ELSE 'sgg-28125' END
    ELSE CASE
        WHEN TRIM(s.`address_neighborhood`) IN (
            '백석동', '마전동', '당하동', '원당동', '대곡동', '금곡동', '왕길동', '불로동',
            '검단동', '불로대곡동', '아라1동', '아라2동'
        ) THEN 'sgg-28290'
        WHEN TRIM(s.`address_neighborhood`) IN ('시천동', '오류동', '오류왕길동') THEN NULL
        WHEN s.`address_full` REGEXP '(^|[ (])(백석동|마전동|당하동|원당동|대곡동|금곡동|왕길동|불로동|검단동|불로대곡동|아라1동|아라2동)([ ),]|$)' THEN 'sgg-28290'
        WHEN s.`address_full` REGEXP '(^|[ (])(시천동|오류동|오류왕길동)([ ),]|$)' THEN NULL
        ELSE 'sgg-28275'
    END
END
SET s.`region_id` = n.`id`;

-- 옛 구를 내린다(인천 아래에 있을 때만 — 승계 구가 없는 DB는 건드리지 않는다)
UPDATE `region` r
JOIN `region` p ON p.`id` = r.`parent_id` AND p.`slug` = 'incheon'
SET r.`is_active` = false, r.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE r.`slug` IN ('sgg-28110', 'sgg-28140', 'sgg-28260') AND r.`is_active` = true;

-- 연결이 남지 않은 옛 구만 삭제한다. 옮기지 못한 매장이 남으면 비활성으로만 둬 관리자 지역 목록(비활성 포함)에 매장 수로 드러나게 한다
UPDATE `region` r
SET r.`deleted_at` = CURRENT_TIMESTAMP(3), r.`updated_at` = CURRENT_TIMESTAMP(3)
WHERE r.`slug` IN ('sgg-28110', 'sgg-28140', 'sgg-28260')
  AND r.`is_active` = false
  AND r.`deleted_at` IS NULL
  AND NOT EXISTS (SELECT 1 FROM `store` s WHERE s.`region_id` = r.`id`);
