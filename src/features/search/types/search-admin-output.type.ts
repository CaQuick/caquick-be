export interface AdminSearchKeywordChipOutput {
  id: string;
  keyword: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
