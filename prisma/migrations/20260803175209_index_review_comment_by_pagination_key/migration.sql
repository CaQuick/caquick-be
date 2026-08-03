-- 커서 쿼리(review_id = ? AND id > ? ORDER BY id) 정합 인덱스로 교체.
-- FK(review_id)가 인덱스를 요구하므로 DROP/ADD를 단일 ALTER로 원자 처리한다.
ALTER TABLE `review_comment`
  DROP INDEX `idx_review_comment_review`,
  ADD INDEX `idx_review_comment_review` (`review_id`, `id`);
