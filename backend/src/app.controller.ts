import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { getFeatureFlags } from './config/features';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * État public des interrupteurs de fonctionnalités, pour masquer les écrans côté frontend.
   */
  @Get('features')
  getFeatures() {
    return getFeatureFlags();
  }
}
