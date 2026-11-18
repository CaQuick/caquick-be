/**
 * auth(구매자 탈퇴)가 order에 묻는 "탈퇴를 막는 주문·환불 수" 읽기 포트.
 * order → auth 의존(관리자 컨텍스트)이 이미 있어 auth가 OrderModule을 import하면 순환이라, 계약은 무의존 common에 두고
 * order가 구현을 제공한다. auth는 첫 호출 때 ModuleRef(strict: false)로 찾는다.
 */
export abstract class WithdrawalBlockingOrderQuery {
  /** 진행 중 주문(입금 대기~제작 완료)과 송금이 끝나지 않은 환불(종류 무관) 수의 합. */
  abstract countByBuyer(accountId: bigint): Promise<number>;
}
