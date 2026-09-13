import {
  Roles,
  ROLES_METADATA_KEY,
} from '@/global/auth/decorators/roles.decorator';

describe('Roles', () => {
  it('클래스에 허용 계정 타입 메타데이터를 남긴다', () => {
    @Roles('SELLER')
    class Target {}

    expect(Reflect.getMetadata(ROLES_METADATA_KEY, Target)).toEqual(['SELLER']);
  });

  it('메서드에 복수 타입을 남긴다', () => {
    class Target {
      @Roles('SELLER', 'ADMIN')
      handler(): void {}
    }

    expect(
      Reflect.getMetadata(ROLES_METADATA_KEY, Target.prototype.handler),
    ).toEqual(['SELLER', 'ADMIN']);
  });
});
