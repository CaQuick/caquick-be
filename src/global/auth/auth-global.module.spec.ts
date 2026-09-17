import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import authConfig from '@/config/auth.config';
import { AuthGlobalModule } from '@/global/auth/auth-global.module';

// JwtModule이 raw env가 아니라 authConfig 해석값(폴백 포함)으로 서명키를 받는지 본다.
describe('AuthGlobalModule', () => {
  const saved = {
    access: process.env.JWT_ACCESS_SECRET,
    legacy: process.env.JWT_SECRET,
  };

  afterEach(() => {
    if (saved.access === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = saved.access;
    if (saved.legacy === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = saved.legacy;
  });

  async function compileWith(env: {
    JWT_ACCESS_SECRET?: string;
    JWT_SECRET?: string;
  }): Promise<JwtService> {
    delete process.env.JWT_ACCESS_SECRET;
    delete process.env.JWT_SECRET;
    Object.assign(process.env, env);

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [authConfig],
        }),
        AuthGlobalModule,
      ],
    }).compile();
    return module.get(JwtService);
  }

  it('JWT_SECRET만 설정돼도 그 값으로 서명한다', async () => {
    const jwt = await compileWith({ JWT_SECRET: 'legacy-only' });

    const token = jwt.sign({ sub: '1' });
    expect(jwt.verify(token, { secret: 'legacy-only' })).toMatchObject({
      sub: '1',
    });
  });

  it('둘 다 있으면 JWT_ACCESS_SECRET으로 서명한다', async () => {
    const jwt = await compileWith({
      JWT_ACCESS_SECRET: 'access',
      JWT_SECRET: 'legacy',
    });

    const token = jwt.sign({ sub: '1' });
    expect(() => jwt.verify(token, { secret: 'legacy' })).toThrow();
    expect(jwt.verify(token, { secret: 'access' })).toMatchObject({ sub: '1' });
  });
});
