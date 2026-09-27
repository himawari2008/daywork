import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DayRecord } from './entities/record.entity';
import { RecordsController } from './records.controller';
import { RecordsService } from './records.service';
import { AiModule } from '../ai/ai.module';
import { SpeechModule } from '../speech/speech.module';
import { GroupsModule } from '../groups/groups.module';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [TypeOrmModule.forFeature([DayRecord]), AiModule, SpeechModule, GroupsModule, LoansModule],
  controllers: [RecordsController],
  providers: [RecordsService],
  exports: [RecordsService],
})
export class RecordsModule {}
