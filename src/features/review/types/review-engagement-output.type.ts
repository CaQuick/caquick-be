export interface MyReviewComment {
  id: string;
  reviewId: string;
  content: string;
  createdAt: Date;
}

export interface ReviewReportResult {
  reportId: string;
  status: 'PENDING' | 'RESOLVED' | 'REJECTED';
  alreadyReported: boolean;
  createdAt: Date;
}
