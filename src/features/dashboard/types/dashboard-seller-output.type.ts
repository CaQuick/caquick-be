export interface SellerDashboardOrderMetrics {
  orderCount: number;
  salesAmount: number;
}

export interface SellerDashboardOutput {
  date: string;
  asOf: Date;
  newOrderCount: number;
  pickupDay: SellerDashboardOrderMetrics;
  createdDay: SellerDashboardOrderMetrics;
  capacity: number | null;
  remainingCapacity: number | null;
  bookedQuantity: number;
  activeProductCount: number;
  unansweredConversationCount: number;
}
