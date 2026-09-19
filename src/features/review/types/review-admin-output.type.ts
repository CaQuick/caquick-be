import type {
  ReviewReportReason,
  ReviewReportStatus,
} from '@/generated/prisma/client';

export interface AdminReviewReportOutput {
  id: string;
  targetType: 'REVIEW' | 'REVIEW_COMMENT';
  targetId: string;
  reporterAccountId: string;
  reason: ReviewReportReason;
  detail: string | null;
  contentSnapshot: string | null;
  status: ReviewReportStatus;
  resolvedByAccountId: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export interface AdminReviewReportDetailOutput {
  report: AdminReviewReportOutput;
  target: {
    id: string;
    reviewId: string | null;
    authorAccountId: string;
    authorNickname: string | null;
    content: string | null;
    storeId: string;
    deleted: boolean;
  };
}

export interface AdminReviewOutput {
  id: string;
  storeId: string;
  storeName: string;
  productId: string;
  authorAccountId: string;
  authorNickname: string | null;
  rating: number;
  content: string | null;
  commentCount: number;
  likeCount: number;
  deleted: boolean;
  createdAt: Date;
}

export interface AdminReviewCommentOutput {
  id: string;
  reviewId: string;
  authorAccountId: string;
  authorNickname: string | null;
  content: string;
  deleted: boolean;
  createdAt: Date;
}
