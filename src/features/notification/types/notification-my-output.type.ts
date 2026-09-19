import type { CursorConnection } from '@/common/types/cursor-connection.type';
import type {
  NotificationEvent,
  NotificationType,
} from '@/generated/prisma/client';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  event: NotificationEvent | null;
  title: string;
  body: string;
  orderId: string | null;
  storeId: string | null;
  productId: string | null;
  reviewId: string | null;
  storeName: string | null;
  productName: string | null;
  readAt: Date | null;
  createdAt: Date;
}

export type NotificationConnection = CursorConnection<NotificationItem>;
