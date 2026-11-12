import { ApiProperty } from '@nestjs/swagger';

export class HealthDto {
  @ApiProperty({ type: 'string', enum: ['ok'], example: 'ok' })
  status: 'ok';
}
