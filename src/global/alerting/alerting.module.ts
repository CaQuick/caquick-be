import { Global, Module } from '@nestjs/common';

import { AlertService } from '@/global/alerting/alert.service';
import {
  ALERT_TRANSPORT,
  postDiscordAlert,
} from '@/global/alerting/discord-webhook';

@Global()
@Module({
  providers: [
    AlertService,
    { provide: ALERT_TRANSPORT, useValue: postDiscordAlert },
  ],
  exports: [AlertService],
})
export class AlertingModule {}
