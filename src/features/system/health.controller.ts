import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

@ApiExcludeController()
@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('profiles')
  getProfiles() {
    return {
      status: 'ok',
      profile: process.env.PROFILE ?? 'unknown',
      port: process.env.PORT,
    };
  }
}
