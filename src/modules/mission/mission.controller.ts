import {
  Controller,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  UseGuards,
  Get,
} from '@nestjs/common';
import { MissionService } from './mission.service';
import { CreateMissionDto } from './dto/create-mission.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';
import { UserUuid } from '@/decorators/user-uuid.decorator';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import {
  ApiCreateMission,
  ApiUpdateMission,
  ApiDeleteMission,
  ApiGetMissionDetail,
  ApiGetAllMissions,
  ApiParticipateMission,
  ApiSubmitMissionResult,
  ApiGetMyMissions,
  ApiCancelMissionParticipation,
} from './decorators/mission.swagger';

@ApiTags('mission')
@ApiBearerAuth('JWT-auth')
@Controller('mission')
@UseGuards(JwtAuthGuard)
export class MissionController {
  constructor(private readonly missionService: MissionService) {}

  // 미션 생성
  @Post()
  @ApiCreateMission()
  create(@Body() dto: CreateMissionDto) {
    return this.missionService.create(dto);
  }

  // 미션 수정
  @Patch(':id')
  @ApiUpdateMission()
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMissionDto) {
    return this.missionService.update(id, dto);
  }

  // 미션 삭제
  @Delete(':id')
  @ApiDeleteMission()
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.missionService.delete(id);
  }

  // 미션 참여하기
  @Post(':missionId/participate')
  @ApiParticipateMission()
  participate(
    @Param('missionId', ParseIntPipe) missionId: number,
    @UserUuid() userUuid: string,
  ) {
    return this.missionService.participate(missionId, userUuid);
  }

  // 내가 참여한 Mission
  @Get('me')
  @ApiGetMyMissions()
  async getMyMissions(@UserUuid() userUuid: string) {
    return this.missionService.findMyMissions(userUuid);
  }

  // 미션 상세정보
  @Get(':id')
  @ApiGetMissionDetail()
  async getDetail(
    @Param('id', ParseIntPipe) id: number,
    @UserUuid() userUuid: string,
  ) {
    return this.missionService.getDetailWithRank(id, userUuid);
  }

  // 데이터 전송
  @Patch(':missionId/result')
  @ApiSubmitMissionResult()
  async submitResult(
    @Param('missionId', ParseIntPipe) missionId: number,
    @UserUuid() userUuid: string,
    @Body('resultData') resultData: number,
  ) {
    return this.missionService.submitResult(missionId, userUuid, resultData);
  }

  // 진행 중 미션 조회
  @Get()
  @ApiGetAllMissions()
  @ApiGetAllMissions()
  async getAllMissions() {
    return this.missionService.findAll();
  }

  // 참여 취소
  @Delete(':id/participation')
  @UseGuards(JwtAuthGuard)
  @ApiCancelMissionParticipation()
  async cancelParticipation(
    @Param('id') missionId: string,
    @UserUuid() userUuid: string,
  ) {
    return this.missionService.cancelParticipation(userUuid, missionId);
  }
}
