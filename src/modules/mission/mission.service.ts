import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Mission } from '@/entities/mission.entity';
import { MissionParticipation } from '@/entities/mission-participation.entity';
import { Repository, In, MoreThan, LessThan } from 'typeorm';
import { CreateMissionDto } from './dto/create-mission.dto';
import { UpdateMissionDto } from './dto/update-mission.dto';
import { User } from '@/entities/user.entity';
import { CustomException } from '../../utils/custom-exception';
import { ErrorCode } from '../../types/error-code.enum';
import { Cron, CronExpression } from '@nestjs/schedule';

type MissionStatus = 'UPCOMING' | 'ONGOING' | 'COMPLETED';

@Injectable()
export class MissionService {
  constructor(
    @InjectRepository(Mission)
    private readonly missionRepo: Repository<Mission>,
    @InjectRepository(MissionParticipation)
    private readonly participationRepo: Repository<MissionParticipation>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async create(dto: CreateMissionDto): Promise<Mission> {
    const mission = this.missionRepo.create(dto);
    return this.missionRepo.save(mission);
  }

  async update(id: number, dto: UpdateMissionDto): Promise<Mission> {
    const mission = await this.missionRepo.findOneBy({ id });
    if (!mission) throw new NotFoundException('해당 미션을 찾을 수 없습니다.');
    Object.assign(mission, dto);
    return this.missionRepo.save(mission);
  }

  async delete(id: number): Promise<void> {
    const mission = await this.missionRepo.findOneBy({ id });
    if (!mission) throw new NotFoundException('해당 미션을 찾을 수 없습니다.');
    await this.missionRepo.remove(mission);
  }

  // 미션 참여
  async participate(
    missionId: number,
    userUuid: string,
  ): Promise<MissionParticipation> {
    const mission = await this.missionRepo.findOneBy({ id: missionId });
    if (!mission) throw new NotFoundException('미션을 찾을 수 없습니다.');

    const exists = await this.participationRepo.findOneBy({
      missionId,
      userUuid,
    });
    if (exists) return exists;

    const participation = this.participationRepo.create({
      missionId,
      userUuid,
      joinedAt: new Date(),
      completed: false,
      resultData: null,
    });

    return this.participationRepo.save(participation);
  }

  // 미션 상세 조회 (랭킹 포함)
  async getDetailWithRank(
    missionId: number,
    userUuid: string,
  ): Promise<{
    mission: Mission;
    isParticipating: boolean;
    myResult: number | null;
    myRank: number | null;
    myName: string | null;
    myProfileImage: string | null;
    rankings: {
      userUuid: string;
      name: string;
      profileImage: string | null;
      result: number;
    }[];
    status: 'UPCOMING' | 'ONGOING' | 'COMPLETED';
  }> {
    const mission = await this.missionRepo.findOneBy({ id: missionId });
    if (!mission) throw new NotFoundException('미션을 찾을 수 없습니다.');

    const now = new Date();
    let status: 'UPCOMING' | 'ONGOING' | 'COMPLETED' = 'UPCOMING';
    if (mission.startTime <= now && mission.endTime >= now) {
      status = 'ONGOING';
    } else if (mission.endTime < now) {
      status = 'COMPLETED';
    }

    const allResults = await this.participationRepo.find({
      where: { missionId },
    });

    const userUuids = allResults.map((p) => p.userUuid);
    const users = await this.userRepo.findBy({ userUuid: In(userUuids) });

    const userMap = new Map(
      users.map((u) => [
        u.userUuid,
        { name: u.nickname, profileImage: u.profileImage },
      ]),
    );

    const ranked = allResults
      .filter((p) => p.resultData != null)
      .map((p) => ({
        userUuid: p.userUuid,
        name: userMap.get(p.userUuid)?.name || '알 수 없음',
        profileImage: userMap.get(p.userUuid)?.profileImage || null,
        result: p.resultData,
      }))
      .sort((a, b) => b.result - a.result);

    const isParticipating = allResults.some((p) => p.userUuid === userUuid);
    const myResult =
      ranked.find((r) => r.userUuid === userUuid)?.result ?? null;
    const myRank = ranked.findIndex((r) => r.userUuid === userUuid);
    const myRankValue = myRank === -1 ? null : myRank + 1;
    const myName = userMap.get(userUuid)?.name ?? null;
    const myProfileImage = userMap.get(userUuid)?.profileImage ?? null;

    return {
      mission,
      isParticipating,
      myResult,
      myRank: myRankValue,
      myName,
      myProfileImage,
      rankings: ranked.slice(0, 20),
      status,
    };
  }

  // 결과 제출
  async submitResult(
    missionId: number,
    userUuid: string,
    resultData: number,
  ): Promise<MissionParticipation> {
    const participation = await this.participationRepo.findOneBy({
      missionId,
      userUuid,
    });

    if (!participation) {
      throw new NotFoundException('해당 미션에 참여한 기록이 없습니다.');
    }

    // 미션 정보 가져오기 (단기 여부 판단용)
    const mission = await this.missionRepo.findOneBy({ id: missionId });
    if (!mission) {
      throw new NotFoundException('미션을 찾을 수 없습니다.');
    }

    const now = new Date();

    if (mission.startTime > now) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_STARTED,
        '아직 미션이 시작되지 않았습니다.',
      );
    }

    if (mission.endTime < now) {
      CustomException.throw(
        ErrorCode.CHALLENGE_ALREADY_FINISHED,
        '챌린지가 이미 종료되었습니다.',
      );
    }

    participation.resultData = resultData;

    // 단기 미션이면 완료 처리
    if (!mission.isLongTerm) {
      participation.completed = true;
    }

    return this.participationRepo.save(participation);
  }

  // 진행 중 & 예정 미션 조회
  async findAll() {
    const now = new Date();

    const missions = await this.missionRepo.find({
      where: {
        endTime: MoreThan(now),
      },
      order: { startTime: 'ASC' },
    });

    return missions.map((mission) => {
      let status: 'UPCOMING' | 'ONGOING';

      if (mission.startTime > now) {
        status = 'UPCOMING';
      } else {
        status = 'ONGOING';
      }

      return {
        ...mission,
        status,
      };
    });
  }

  // 내 참여 미션 조회
  async findMyMissions(userUuid: string) {
    const participations = await this.participationRepo.find({
      where: { userUuid },
      order: { joinedAt: 'DESC' },
    });

    const missionIds = participations.map((p) => p.missionId);
    if (missionIds.length === 0) return [];

    const missions = await this.missionRepo.find({
      where: { id: In(missionIds) },
    });

    const now = new Date();

    return missions
      .filter((mission) => mission) // 혹시라도 null 방지
      .map((mission) => {
        let status: MissionStatus;
        if (now < mission.startTime) status = 'UPCOMING';
        else if (now <= mission.endTime) status = 'ONGOING';
        else status = 'COMPLETED';

        return {
          id: mission.id,
          title: mission.title,
          description: mission.description,
          type: mission.type,
          startTime: mission.startTime,
          endTime: mission.endTime,
          reward: mission.reward,
          status,
        };
      });
  }

  // 참여 취소
  async cancelParticipation(userUuid: string, missionId: string) {
    const participation = await this.participationRepo.findOne({
      where: { userUuid, missionId },
    });

    if (!participation) {
      throw new NotFoundException('참여 기록이 없습니다.');
    }

    await this.participationRepo.remove(participation);

    return { message: '미션 참여가 취소되었습니다.' };
  }

  /**
   * 매일 00:00 실행
   * 1) 오늘 시작하는 미션: 로그 출력
   * 2) 종료된 미션 중 보상 미지급(rewardsDistributed=false): 상위 rank명에게 reward 지급
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyMissionJobs() {
    const now = new Date();

    //종료된 미션 중 보상 미지급 분배
    const endedMissions = await this.missionRepo.find({
      where: { endTime: LessThan(now), rewardsDistributed: false },
      order: { endTime: 'ASC' },
    });

    if (endedMissions.length === 0) {
      return;
    }

    for (const mission of endedMissions) {
      try {
        // 해당 미션 참여자 로드
        const participations = await this.participationRepo.find({
          where: { missionId: mission.id },
        });

        if (participations.length === 0) {
          console.log(' - 참여자 없음 → 보상 없이 종료 표시');
          mission.rewardsDistributed = true;
          await this.missionRepo.save(mission);
          continue;
        }

        // 결과 있는 참여자만 추출 (resultData null 제외)
        const withResult = participations
          .filter((p) => typeof p.resultData === 'number')
          .sort((a, b) => b.resultData! - a.resultData!); // 내림차순: 큰 값이 상위

        if (withResult.length === 0) {
          mission.rewardsDistributed = true;
          await this.missionRepo.save(mission);
          continue;
        }

        // 상위 N명 추출 (mission.rank)
        const topN = Math.max(0, mission.rewardTopN ?? 0);
        const winners = withResult.slice(0, topN);

        if (winners.length === 0) {
          mission.rewardsDistributed = true;
          await this.missionRepo.save(mission);
          continue;
        }

        // 보상 지급 대상 userUuid 모음
        const winnerUuids = winners.map((p) => p.userUuid);
        const winnerUsers = await this.userRepo.find({
          where: { userUuid: In(winnerUuids) },
        });

        // 유저 맵핑 (없을 수도 있으니 방어)
        const userMap = new Map(winnerUsers.map((u) => [u.userUuid, u]));

        // 코인 지급
        for (const w of winners) {
          const u = userMap.get(w.userUuid);
          if (!u) {
            console.log(`사용자 없음(userUuid=${w.userUuid})`);
            continue;
          }
          u.coins = (u.coins ?? 0) + (mission.reward ?? 0);
          await this.userRepo.save(u);

          // 참여 레코드 표시
          w.rewarded = true;
          await this.participationRepo.save(w);
        }

        // 미션 보상 분배 완료 플래그
        mission.rewardsDistributed = true;
        await this.missionRepo.save(mission);

        console.log(` [정산 완료] 미션 ${mission.id}`);
      } catch (err: any) {
        console.error(
          ` [정산 오류] 미션 ${mission.id} 처리 중 에러:`,
          err?.message || err,
        );
        // 오류가 나도 다른 미션은 계속 진행 (고의적으로 전체 중단 X)
      }
    }

    console.log('[미션 스케줄러] 모든 종료/미지급 미션 정산 완료');
  }
}
