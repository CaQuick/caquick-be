import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AccountCryptoConfig } from '@/config/account-crypto.config';
import { AccountCipher } from '@/global/crypto/account-cipher.service';
import { CustomLoggerService } from '@/global/logger/custom-logger.service';

@Global()
@Module({
  providers: [
    {
      provide: AccountCipher,
      inject: [ConfigService, CustomLoggerService],
      useFactory: (config: ConfigService, logger: CustomLoggerService) => {
        const crypto = config.getOrThrow<AccountCryptoConfig>('accountCrypto');
        if (crypto.devKeyReason) {
          logger.warn(
            `계좌번호 암호화에 고정 개발 키를 씁니다: ${crypto.devKeyReason}`,
            AccountCipher.name,
          );
        }
        return new AccountCipher(crypto);
      },
    },
  ],
  exports: [AccountCipher],
})
export class CryptoModule {}
