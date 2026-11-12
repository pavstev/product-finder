import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiProblemResponse } from '@product-finder/api';
import { HealthDto } from './health.dto.js';
import { HealthService } from './health.service.js';

// Probes for Docker and Kubernetes. `live` does no IO, so a database outage never restarts the API.
// `ready` runs SELECT 1 and gives 503 when it fails. A stale catalogue is not a readiness failure.
@ApiTags('health')
// Never rate limited. Name both throttlers: a bare @SkipThrottle() skips only one named "default".
@SkipThrottle({ read: true, write: true })
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  // The method name is the operationId in the OpenAPI document.
  @Get('live')
  @ApiOperation({ summary: 'Check that the API process is up. It does no IO.' })
  @ApiOkResponse({ type: HealthDto, description: 'The process answers.' })
  getLiveness(): HealthDto {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check that the API can reach its database within one second.' })
  @ApiOkResponse({ type: HealthDto, description: 'The API and the database answer.' })
  @ApiProblemResponse(503, 'The database does not answer within one second.')
  getReadiness(): Promise<HealthDto> {
    return this.health.ready();
  }

  // Kept for v1 links. The same answer as GET /api/health/ready.
  @Get()
  @ApiOperation({
    summary: 'Check that the API and its database answer. Use GET /api/health/ready instead.',
    deprecated: true,
  })
  @ApiOkResponse({ type: HealthDto, description: 'The API and the database answer.' })
  @ApiProblemResponse(503, 'The database does not answer.')
  getHealth(): Promise<HealthDto> {
    return this.health.ready();
  }
}
