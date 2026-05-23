import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Planner-Pro Backend API v1.0.0';
  }
}
