-- 미처리 신고 중복 방지를 잠금에서 unique 제약으로 바꾼다(D7-c).
-- open_key는 PENDING 동안에만 대상 식별자를 담고 종결되면 NULL — MySQL unique는 NULL을 중복으로 보지 않으므로
-- "같은 신고자·같은 대상의 PENDING은 1건, 처리 뒤에는 다시 신고 가능"이 제약으로 표현된다.
-- 3단계: ① nullable 컬럼 추가 → ② 값 백필(중복은 가장 오래된 1건만 유지) → ③ unique 인덱스 생성.
ALTER TABLE `review_report` ADD COLUMN `open_key` VARCHAR(40) NULL;

-- backfill
UPDATE `review_report`
  SET `open_key` = CASE
    WHEN `review_comment_id` IS NOT NULL THEN CONCAT('c:', `review_comment_id`)
    WHEN `review_id` IS NOT NULL THEN CONCAT('r:', `review_id`)
    ELSE NULL
  END
  WHERE `status` = 'PENDING' AND `deleted_at` IS NULL;
-- 기존 데이터에 같은 신고자·대상의 PENDING이 여러 건이면 가장 오래된 1건만 키를 유지한다(나머지는 unique 밖으로)
UPDATE `review_report` r
  JOIN (
    SELECT `reporter_account_id`, `open_key`, MIN(`id`) AS keep_id
    FROM `review_report`
    WHERE `open_key` IS NOT NULL
    GROUP BY `reporter_account_id`, `open_key`
    HAVING COUNT(*) > 1
  ) dup
    ON dup.`reporter_account_id` = r.`reporter_account_id`
    AND dup.`open_key` = r.`open_key`
    AND r.`id` <> dup.keep_id
  SET r.`open_key` = NULL;
-- end backfill

CREATE UNIQUE INDEX `uk_review_report_open` ON `review_report`(`reporter_account_id`, `open_key`);
