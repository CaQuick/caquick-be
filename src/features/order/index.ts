// cross-feature 공개 API. 단일 구현 repo라 토큰/인터페이스 없이 구체 클래스로 주입(의도적).
export { OrderModule } from '@/features/order/order.module';
// 주문 집계(dashboard feature)와 주문 읽기(user·notification).
export { OrderRepository } from '@/features/order/repositories/order.repository';
