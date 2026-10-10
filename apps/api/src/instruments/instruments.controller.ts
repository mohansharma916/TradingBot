import { Controller, Get, Param, Query, Inject } from '@nestjs/common';
import { Instrument, InstrumentType } from '@trading-bot/contracts';
import { InstrumentCatalogService } from './instrument-catalog.service';

@Controller('instruments')
export class InstrumentsController {
  constructor(
    @Inject(InstrumentCatalogService) private readonly catalog: InstrumentCatalogService,
  ) {}

  @Get('search')
  search(
    @Query('query') query = '',
    @Query('underlying') underlying?: string,
    @Query('instrumentType') instrumentType?: InstrumentType,
    @Query('limit') limit = 20,
  ): Instrument[] {
    return this.catalog.searchInstruments({
      query,
      underlying,
      instrumentType,
      limit: Number(limit),
    });
  }

  @Get('expiries/:underlying')
  getExpiries(@Param('underlying') underlying: string): string[] {
    return this.catalog.getAvailableExpiries(underlying);
  }

  @Get(':key')
  getInstrument(@Param('key') key: string): Instrument | { error: string } {
    const inst = this.catalog.getInstrument(decodeURIComponent(key));
    if (!inst) {
      return { error: `Instrument with key ${key} not found in catalog.` };
    }
    return inst;
  }
}
