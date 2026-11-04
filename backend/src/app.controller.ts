import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './auth/public.decorator';
import { getFeatureFlags } from './config/features';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * État public des interrupteurs de fonctionnalités, pour masquer les écrans côté frontend.
   */
  @Public()
  @Get('features')
  getFeatures() {
    return getFeatureFlags();
  }
}
