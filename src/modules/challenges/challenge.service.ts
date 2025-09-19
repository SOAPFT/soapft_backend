import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Challenge } from '@/entities/challenge.entity';
import { CreateChallengeDto } from './dto/create-challenge.dto';
import { UpdateChallengeDto } from './dto/update-challenge.dto';
import { FindAllChallengesDto } from './dto/find-all-challenges.dto';
import { User } from '@/entities/user.entity';
import { Post } from '@/entities/post.entity';
import { ChatService } from '../chat/chat.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ulid } from 'ulid';
import {
  ChallengeType,
  GenderType,
  ChallengeFilterType,
} from '@/types/challenge.enum';
import { ChatRoomType } from '@/types/chat.enum';
import { CustomException } from '@/utils/custom-exception';
import { ErrorCode } from '@/types/error-code.enum';
import { MoreThan, LessThan, MoreThanOrEqual, Between, ILike } from 'typeorm';
import { subDays } from 'date-fns';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MissionParticipation } from '@/entities/mission-participation.entity';
import { Mission } from '@/entities/mission.entity';
import { BadRequestException } from '@nestjs/common';

/**
 * 나이 계산 함수
 * @param birthDate
 * @returns
 */
function calculateAge(birthDate: Date | string): number {
  const dateObj = birthDate instanceof Date ? birthDate : new Date(birthDate);
  const today = new Date();
  return today.getFullYear() - dateObj.getFullYear() + 1;
}

function formatDateLocal(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class ChallengeService {
  constructor(
    @InjectRepository(Challenge)
    private challengeRepository: Repository<Challenge>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Post)
    private postRepository: Repository<Post>,
    @InjectRepository(MissionParticipation)
    private missionParticipationRepo: Repository<MissionParticipation>,
    @InjectRepository(Mission)
    private missionRepository: Repository<Mission>,
    private chatService: ChatService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * 챌린지 생성
   */
  async createChallenge(
    createChallengeDto: CreateChallengeDto,
    userUuid: string,
  ) {
    // 날짜 check
    const now = new Date();
    const startDate = new Date(createChallengeDto.start_date);
    const endDate = new Date(createChallengeDto.end_date);
    const user = await this.userRepository.findOne({ where: { userUuid } });

    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '사용자를 찾을 수 없습니다.',
      );
    }

    if (user.coins - createChallengeDto.coin_amount < 0) {
      CustomException.throw(
        ErrorCode.INSUFFICIENT_COINS,
        '챌린지를 생성할 코인이 부족합니다.',
      );
    }

    user.coins = user.coins - createChallengeDto.coin_amount;

    // 시작일이 현재보다 과거
    if (startDate < now) {
      CustomException.throw(
        ErrorCode.INVALID_CHALLENGE_DATES,
        '시작일은 현재 시각 이후여야 합니다.',
      );
    }

    // 종료일 체크
    if (endDate < startDate) {
      CustomException.throw(
        ErrorCode.INVALID_CHALLENGE_DATES,
        '종료일은 시작일보다 이후여야 합니다.',
      );
    }
    if (endDate < now) {
      CustomException.throw(
        ErrorCode.INVALID_CHALLENGE_DATES,
        '종료일은 현재 시각 이후여야 합니다.',
      );
    }

    const userAge = calculateAge(user.birthDate);
    const { start_age, end_age } = createChallengeDto;

    if (!(start_age <= userAge && userAge <= end_age)) {
      CustomException.throw(
        ErrorCode.AGE_RESTRICTION_NOT_MET,
        `챌린지 생성 연령 조건에 맞지 않습니다. (${start_age}세 ~ ${end_age}세)`,
      );
    }

    // TODO: 챌린지 생성 로직 구현
    const challengeUuid = ulid();
    const challenge = await this.challengeRepository.create({
      challengeUuid,
      title: createChallengeDto.title,
      type: ChallengeType.NORMAL,
      profile: createChallengeDto.profile,
      banner: createChallengeDto.banner,
      introduce: createChallengeDto.introduce,
      verificationGuide: createChallengeDto.verificationGuide,
      startDate,
      endDate,
      goal: createChallengeDto.goal,
      startAge: createChallengeDto.start_age,
      endAge: createChallengeDto.end_age,
      gender: createChallengeDto.gender,
      maxMember: createChallengeDto.max_member,
      creatorUuid: userUuid,
      participantUuid: [userUuid],
      coinAmount: createChallengeDto.coin_amount,
      isStarted: false,
      isFinished: false,
      successParticipantsUuid: [],
    });

    await this.challengeRepository.save(challenge);
    await this.userRepository.save(user);

    // 챌린지 채팅방 자동 생성
    try {
      await this.chatService.createChatRoom(userUuid, {
        type: ChatRoomType.GROUP,
        participantUuids: [userUuid],
        name: `${createChallengeDto.title} 채팅방`,
        challengeUuid: challenge.challengeUuid,
      });
    } catch (error) {
      // 채팅방 생성 실패 시 로그만 남기고 계속 진행
      console.error('채팅방 생성 실패:', error);
    }

    return {
      message: '챌린지가 성공적으로 생성되었습니다.',
      challengeUuid: challenge.challengeUuid,
    };
  }

  /**
   * 모든 챌린지 조회
   */
  async findAllChallenges(findAllChallengesDto: FindAllChallengesDto) {
    // TODO: 챌린지 목록 조회 로직 구현
    const {
      page = 1,
      limit = 10,
      type,
      gender = GenderType.NONE,
      status,
    } = findAllChallengesDto;

    const where: Record<string, any> = {};

    if (type) where.type = type;
    if (gender) where.gender = gender;

    const now = new Date();

    if (status === 'before') {
      where.startDate = MoreThan(now);
    } else if (status === 'in_progress') {
      where.startDate = LessThan(now);
      where.endDate = MoreThan(now);
    } else if (status === 'completed') {
      where.endDate = LessThan(now);
    }

    const [challenges, total] = await this.challengeRepository.findAndCount({
      where,
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return {
      data: challenges,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  /**
   * 챌린지 상세 조회
   */
  async findOneChallenge(challengeUuid: string, userUuid: string) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 아이디의 챌린지가 없습니다.',
      );
    }

    const isParticipated = challenge.participantUuid.includes(userUuid);

    // 참여자 목록 조회
    const participants = await this.userRepository.find({
      where: challenge.participantUuid.map((uuid) => ({ userUuid: uuid })),
      select: ['userUuid', 'nickname', 'profileImage'],
    });

    const now = new Date();
    let status: 'UPCOMING' | 'ONGOING' | 'COMPLETED';

    if (challenge.startDate > now) {
      status = 'UPCOMING';
    } else if (challenge.endDate < now) {
      status = 'COMPLETED';
    } else {
      status = 'ONGOING';
    }

    return {
      ...challenge,
      isParticipated,
      participants,
      status,
    };
  }

  /**
   * 사용자가 참여한 챌린지 조회
   */
  async findUserChallenges(userUuid: string, status: ChallengeFilterType) {
    const now = new Date();

    // 1. 참여한 Challenge 조회 (소셜 챌린지)
    const challengeQb = this.challengeRepository
      .createQueryBuilder('challenge')
      .where(':userUuid = ANY(challenge.participantUuid)', { userUuid });

    if (status === ChallengeFilterType.ONGOING) {
      challengeQb.andWhere(
        'challenge.startDate <= :now AND challenge.endDate >= :now',
        { now },
      );
    } else if (status === ChallengeFilterType.UPCOMING) {
      challengeQb.andWhere('challenge.startDate > :now', { now });
    }

    const challenges = await challengeQb.getMany();

    // 2. 참여한 Mission 목록 조회
    const missionParticipations = await this.missionParticipationRepo.find({
      where: { userUuid },
    });

    const missionIds = missionParticipations.map((p) => p.missionId);
    const missions = await this.missionRepository.findByIds(missionIds);

    // 3. Mission 상태 필터링
    const filteredMissions = missions.filter((m) => {
      if (status === ChallengeFilterType.ONGOING) {
        return m.startTime <= now && m.endTime >= now;
      } else if (status === ChallengeFilterType.UPCOMING) {
        return m.startTime > now;
      }
      return true;
    });

    // 4. 데이터 형식 맞춰주기 (Mission 참여자 수 조회 불필요)

    // 5. 데이터 형식 맞춰주기
    const formattedChallenges = challenges.map((c) => ({
      id: c.id,
      challengeUuid: c.challengeUuid,
      title: c.title,
      banner: c.banner,
      maxMember: c.maxMember,
      currentMember: c.participantUuid.length,
      challengeType: 'GROUP',
      sortKey: new Date(c.startDate).getTime(),
      startDate: c.startDate,
      endDate: c.endDate,
      isStarted: new Date(c.startDate) <= now,
      isFinished: new Date(c.endDate) < now,
    }));

    const formattedMissions = filteredMissions.map((m) => {
      return {
        id: m.id,
        challengeUuid: null,
        title: m.title,
        banner: null,
        maxMember: null,
        currentMember: null,
        challengeType: 'EVENT',
        sortKey: new Date(m.startTime).getTime(),
        startDate: m.startTime,
        endDate: m.endTime,
        isStarted: new Date(m.startTime) <= now,
        isFinished: new Date(m.endTime) < now,
      };
    });

    const sorted = [...formattedChallenges, ...formattedMissions].sort(
      (a, b) => a.sortKey - b.sortKey,
    );

    // sortKey 제거하고 최종 결과 반환
    const finalResult = sorted.map((item) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { sortKey, ...rest } = item;
      return rest;
    });

    return finalResult;
  }

  /**
   * 사용자가 성공한 챌린지 수 조회
   */
  async countUserCompletedChallenges(userUuid: string) {
    const count = await this.challengeRepository
      .createQueryBuilder('challenge')
      .where(':userUuid = ANY(challenge.successParticipantsUuid)', {
        userUuid,
      })
      .getCount();

    return {
      message: '조회 성공',
      completedChallengeCount: count,
    };
  }

  /**
   * 챌린지 수정
   */
  async updateChallenge(
    challengeUuid: string,
    updateChallengeDto: UpdateChallengeDto,
    userUuid: string,
  ) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 아이디의 챌린지가 없습니다.',
      );
    }

    if (challenge.creatorUuid !== userUuid) {
      CustomException.throw(
        ErrorCode.CHALLENGE_CANNOT_EDIT,
        '챌린지를 수정할 권한이 없습니다.',
      );
    }

    if (updateChallengeDto.banner) {
      challenge.banner = updateChallengeDto.banner;
    }
    if (updateChallengeDto.profile) {
      challenge.profile = updateChallengeDto.profile;
    }

    await this.challengeRepository.save(challenge);

    return {
      message: '챌린지 수정을 성공했습니다.',
      challenge,
    };
  }

  /**
   * 최근 생성된 챌린지 목록
   */

  async getRecentChallenges() {
    const onWeekAgo = subDays(new Date(), 7);

    const challenges = await this.challengeRepository.find({
      where: {
        createdAt: MoreThanOrEqual(onWeekAgo),
      },
      order: {
        createdAt: 'DESC',
      },
      take: 15,
    });

    return challenges;
  }

  /**
   * 인기 챌린지 목록
   */
  async getPopularChallenges() {
    const challenges = await this.challengeRepository
      .createQueryBuilder('challenge')
      .addSelect('CARDINALITY(challenge.participantUuid)', 'participantCount')
      .where("challenge.createdAt >= NOW() - INTERVAL '1 month'") // 최근 1개월 이내 생성
      .orderBy('CARDINALITY(challenge.participantUuid)', 'DESC')
      .limit(15)
      .getMany();

    // 15개가 안되면 기간 조건을 제거하고 다시 조회
    if (challenges.length < 15) {
      const allChallenges = await this.challengeRepository
        .createQueryBuilder('challenge')
        .addSelect('CARDINALITY(challenge.participantUuid)', 'participantCount')
        .orderBy('CARDINALITY(challenge.participantUuid)', 'DESC')
        .limit(15)
        .getMany();

      return allChallenges;
    }

    return challenges;
  }

  /**
   * 챌린지 참여
   */
  async joinChallenge(challengeUuid: string, userUuid: string) {
    // 1) 먼저 조회
    const [challenge, user] = await Promise.all([
      this.challengeRepository.findOne({ where: { challengeUuid } }),
      this.userRepository.findOne({ where: { userUuid } }),
    ]);

    // 2) 널 가드
    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 아이디의 챌린지가 없습니다.',
      );
    }
    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '사용자 정보를 찾을 수 없습니다.',
      );
    }

    // 3) 필드 유효성 가드
    if (!challenge.startDate || !challenge.endDate) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '챌린지 기간 정보가 없습니다.',
      );
    }
    // participantUuid는 항상 배열 보장
    challenge.participantUuid ??= [];

    // 4) 이제 안전하게 날짜 계산
    const now = new Date();
    const startDate = new Date(challenge.startDate);
    const endDate = new Date(challenge.endDate);

    // 5) 조건 체크
    if (
      challenge.gender !== GenderType.NONE &&
      challenge.gender !== user.gender
    ) {
      CustomException.throw(
        ErrorCode.GENDER_RESTRICTION_NOT_MET,
        '성별 조건을 만족하지 않습니다.',
      );
    }

    if (!user.birthDate) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '사용자 생년월일 정보가 없습니다.',
      );
    }
    const userAge = calculateAge(user.birthDate);

    // endAge가 null이면 startAge 이상만 체크
    if (challenge.endAge == null) {
      if (userAge < challenge.startAge) {
        CustomException.throw(
          ErrorCode.AGE_RESTRICTION_NOT_MET,
          '참여 가능한 연령 조건을 만족하지 않습니다.',
        );
      }
    } else {
      if (!(challenge.startAge <= userAge && userAge <= challenge.endAge)) {
        CustomException.throw(
          ErrorCode.AGE_RESTRICTION_NOT_MET,
          '참여 가능한 연령 조건을 만족하지 않습니다.',
        );
      }
    }

    if (
      challenge.maxMember != null &&
      challenge.participantUuid.length >= challenge.maxMember
    ) {
      CustomException.throw(ErrorCode.CHALLENGE_FULL, '정원이 다 찼습니다.');
    }

    if (challenge.participantUuid.includes(userUuid)) {
      CustomException.throw(
        ErrorCode.ALREADY_JOINED_CHALLENGE,
        '이미 참가한 챌린지 입니다.',
      );
    }

    if (user.coins == null || challenge.coinAmount == null) {
      CustomException.throw(
        ErrorCode.COIN_TRANSACTION_FAILED,
        '코인 정보가 올바르지 않습니다.',
      );
    }
    if (user.coins < challenge.coinAmount) {
      CustomException.throw(
        ErrorCode.INSUFFICIENT_COINS,
        '챌린지에 참여할 코인이 부족합니다.',
      );
    }

    if (endDate.getTime() < now.getTime()) {
      CustomException.throw(
        ErrorCode.CHALLENGE_ALREADY_FINISHED,
        '이미 종료된 챌린지 입니다.',
      );
    }
    // 이미 시작되었으면 막는 정책이면 <= 로
    if (startDate.getTime() <= now.getTime()) {
      CustomException.throw(
        ErrorCode.CHALLENGE_ALREADY_STARTED,
        '이미 시작된 챌린지입니다.',
      );
    }

    // 6) 상태 변경 (동시성 고려: 실제 운영이면 트랜잭션+락 권장)
    user.coins -= challenge.coinAmount;
    challenge.participantUuid.push(userUuid);

    await this.challengeRepository.save(challenge);
    await this.userRepository.save(user);

    try {
      await this.chatService.addParticipantToChallengeRoom(
        challengeUuid,
        userUuid,
      );
    } catch (error) {
      console.error('채팅방 참여 실패:', error);
    }

    return { message: '참가 완료', challengeUuid };
  }

  /**
   * 챌린지 진행률 조회
   */
  async getUserChallengeProgress(userUuid: string, challengeUuid: string) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      throw new BadRequestException('해당 아이디의 챌린지가 없습니다.');
    }

    const { startDate, endDate, goal, participantUuid } = challenge;

    // 종료일 포함 처리 (필요시 endOfDay로 보정)
    const endInclusive = new Date(endDate.getTime());

    // 해당 기간 게시물 조회
    const posts = await this.postRepository.find({
      where: {
        userUuid,
        challengeUuid,
        createdAt: Between(startDate, endInclusive),
      },
      select: ['createdAt'], // 최소 컬럼만
    });

    // 주차별: 같은 날 중복 제거(Set)
    const weekMap: Record<number, Set<string>> = {};
    for (const post of posts) {
      const diffMs = post.createdAt.getTime() - startDate.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const weekNum = Math.floor(diffDays / 7) + 1; // 1주차부터
      const dateKey = formatDateLocal(post.createdAt); // 하루 1회만 인정
      (weekMap[weekNum] ??= new Set()).add(dateKey);
    }

    // 전체 주차 수 (부분 주 포함)
    const totalWeeks = Math.ceil(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 7),
    );

    // 가중치
    const weekWeight = totalWeeks > 0 ? 100 / totalWeeks : 0;
    const perActionWeight = goal > 0 ? weekWeight / goal : 0;

    // 총 달성률 계산 (주 목표 초과분은 버림)
    let totalAchievementRate = 0;
    for (let i = 1; i <= totalWeeks; i++) {
      const count = weekMap[i]?.size ?? 0; // 그 주 인정 일수
      const weeklyContribution = Math.min(count, goal); // 초과분 버림
      totalAchievementRate += weeklyContribution * perActionWeight;
    }
    totalAchievementRate = Math.min(100, Math.round(totalAchievementRate));

    // 참가자 수 안전 계산
    const participantCount = Array.isArray(participantUuid)
      ? participantUuid.length
      : 0;

    // ✅ 요청한 형태로만 반환
    return {
      challengeInfo: {
        participantCount,
        startDate,
        endDate,
        goal,
      },
      totalAchievementRate,
    };
  }

  /**
   * 챌린지 탈퇴
   */
  async leaveChallenge(challengeUuid: string, userUuid: string) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 아이디의 챌린지가 없습니다.',
      );
    }

    if (challenge.isStarted) {
      CustomException.throw(
        ErrorCode.CHALLENGE_ALREADY_STARTED,
        '챌린지가 시작되어 나갈 수 없습니다.',
      );
    }

    // 유저 정보 조회
    const user = await this.userRepository.findOne({
      where: { userUuid },
    });

    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 유저가 존재하지 않습니다.',
      );
    }

    // 참여자 배열에서 제거
    challenge.participantUuid = challenge.participantUuid.filter(
      (uuid) => uuid !== userUuid,
    );

    // 코인 반환
    user.coins += challenge.coinAmount;

    // DB 저장
    await Promise.all([
      this.challengeRepository.save(challenge),
      this.userRepository.save(user),
    ]);

    // 채팅방 퇴장 처리
    try {
      await this.chatService.removeParticipantFromChallengeRoom(
        challengeUuid,
        userUuid,
      );
    } catch (error) {
      console.error('채팅방 나가기 실패:', error);
    }

    return {
      message: '챌린지에서 성공적으로 탈퇴하고 코인이 반환되었습니다.',
      refundedCoins: challenge.coinAmount,
      currentCoin: user.coins,
    };
  }

  /**
   * 챌린지 검색
   */
  async searchChallenges(
    keyword: string,
    page: number,
    limit: number,
    userUuid: string,
  ) {
    // 1. 그룹 챌린지 검색
    const groupResults = await this.challengeRepository.find({
      where: [
        { title: ILike(`%${keyword}%`) },
        { introduce: ILike(`%${keyword}%`) },
      ],
      order: { createdAt: 'DESC' },
    });
    const now = new Date();

    const formattedChallenges = groupResults.map((challenge) => ({
      id: challenge.id,
      challengeUuid: challenge.challengeUuid,
      title: challenge.title,
      banner: challenge.banner,
      maxMember: challenge.maxMember,
      currentMember: challenge.participantUuid.length,
      challengeType: 'GROUP',
      isParticipated: challenge.participantUuid.includes(userUuid),
      sortKey: new Date(challenge.startDate).getTime(),
      startDate: challenge.startDate,
      endDate: challenge.endDate,
      isStarted: new Date(challenge.startDate) <= now,
      isFinished: challenge.endDate ? new Date(challenge.endDate) < now : false,
    }));

    // 2. 미션 검색
    const allMissions = await this.missionRepository.find({
      order: { createdAt: 'DESC' },
    });

    const missionParticipations = await this.missionParticipationRepo.find({
      where: { userUuid },
    });
    const participatedMissionIds = missionParticipations.map(
      (p) => p.missionId,
    );

    const matchedMissions = allMissions.filter(
      (m) => m.title.includes(keyword) || m.description.includes(keyword),
    );

    const formattedMissions = matchedMissions.map((mission) => ({
      id: mission.id,
      challengeUuid: null,
      title: mission.title,
      banner: null,
      maxMember: null,
      currentMember: null,
      challengeType: 'EVENT',
      isParticipated: participatedMissionIds.includes(mission.id),
      sortKey: new Date(mission.startTime).getTime(),
      startDate: mission.startTime,
      endDate: mission.endTime,
      isStarted: new Date(mission.startTime) <= now,
      isFinished: new Date(mission.endTime) < now,
    }));

    // 3. 그룹 + 미션 병합 후 정렬
    const merged = [...formattedChallenges, ...formattedMissions].sort(
      (a, b) => b.sortKey - a.sortKey,
    ); // 최신순 정렬

    // 4. 페이지네이션 수동 적용
    const start = (page - 1) * limit;
    const end = start + limit;
    const paginated = merged.slice(start, end);

    // sortKey 제거하고 반환
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const finalData = paginated.map(({ sortKey, ...rest }) => rest);

    return {
      data: finalData,
      meta: {
        total: merged.length,
        page,
        limit,
        totalPages: Math.ceil(merged.length / limit),
        hasNextPage: end < merged.length,
      },
    };
  }

  /**
   * 시작일이 지난 챌린지 자동으로 isStart = true 처리
   * 종료일이 지난 챌린지를 자동으로 종료 처리
   * 100% 달성한 참여자를 successParticipantsUuid에 추가
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async updateChallengeStatuses() {
    const now = new Date();

    /**
     * 1. 오늘 시작해야 하는 챌린지 시작 처리
     */
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const startingChallenges = await this.challengeRepository.find({
      where: {
        startDate: Between(startOfDay, endOfDay),
        isStarted: false,
      },
    });

    for (const challenge of startingChallenges) {
      challenge.isStarted = true;
      await this.challengeRepository.save(challenge);

      // 참여자들에게 챌린지 시작 알림 발송
      if (challenge.participantUuid && challenge.participantUuid.length > 0) {
        try {
          await this.notificationsService.createChallengeStartNotification(
            challenge.participantUuid,
            challenge.title,
            challenge.challengeUuid,
          );
        } catch (error) {
          console.error(
            `챌린지 시작 알림 발송 실패: ${challenge.challengeUuid}`,
            error,
          );
        }
      }
    }

    console.log(
      `[스케줄러] ${startingChallenges.length}개의 챌린지가 시작 처리되었습니다.`,
    );

    /**
     * 2. 종료일이 지났고, 아직 종료 처리되지 않은 챌린지 종료 처리
     */
    const expiredChallenges = await this.challengeRepository.find({
      where: {
        endDate: LessThan(now),
        isFinished: false,
      },
    });

    for (const challenge of expiredChallenges) {
      const successParticipants: string[] = [];

      // 참여자별 진행률 조회
      for (const userUuid of challenge.participantUuid) {
        const { totalAchievementRate } = await this.getUserChallengeProgress(
          userUuid,
          challenge.challengeUuid,
        );

        // 달성률 100%인 경우 successParticipants에 추가
        if (totalAchievementRate === 100) {
          successParticipants.push(userUuid);
        }
      }

      // 성공자에게 보상 코인 지급
      const totalParticipants = challenge.participantUuid.length;
      const totalCoins = totalParticipants * challenge.coinAmount;
      const numSuccess = successParticipants.length;

      if (numSuccess > 0) {
        const rewardPerSuccess = Math.floor(totalCoins / numSuccess);

        for (const userUuid of successParticipants) {
          const user = await this.userRepository.findOne({
            where: {
              userUuid,
            },
          });

          if (user) {
            user.coins += rewardPerSuccess;
            await this.userRepository.save(user);
          }
        }
      }

      // 챌린지 업데이트
      challenge.successParticipantsUuid = successParticipants;
      challenge.isFinished = true;

      await this.challengeRepository.save(challenge);

      // 참여자들에게 챌린지 종료 알림 발송
      if (challenge.participantUuid && challenge.participantUuid.length > 0) {
        try {
          // 성공자와 실패자 분리
          const failedParticipants = challenge.participantUuid.filter(
            (uuid) => !successParticipants.includes(uuid),
          );

          // 성공자들에게 성공 알림
          if (successParticipants.length > 0) {
            await this.notificationsService.createChallengeEndNotification(
              successParticipants,
              challenge.title,
              challenge.challengeUuid,
              true, // 성공
            );
          }

          // 실패자들에게 실패 알림
          if (failedParticipants.length > 0) {
            await this.notificationsService.createChallengeEndNotification(
              failedParticipants,
              challenge.title,
              challenge.challengeUuid,
              false, // 실패
            );
          }
        } catch (error) {
          console.error(
            `챌린지 종료 알림 발송 실패: ${challenge.challengeUuid}`,
            error,
          );
        }
      }
    }

    console.log(
      `[스케줄러] ${expiredChallenges.length}개의 챌린지가 종료 처리되었습니다.`,
    );
  }

  /**
   * 챌린지 월별 인증 현황 조회
   */
  async getMonthlyChallengeStats(
    challengeUuid: string,
    year: number,
    month: number,
  ) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999); // 해당 달의 마지막 날 끝 시간

    const posts = await this.postRepository
      .createQueryBuilder('post')
      .select(['post.id', 'post.userUuid', 'post.createdAt'])
      .where('post.challengeUuid = :challengeUuid', { challengeUuid })
      .andWhere('post.createdAt BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getMany();

    // 날짜별로 그룹핑
    const result: Record<string, { count: number; users: any[] }> = {};

    for (const post of posts) {
      const dateKey = post.createdAt.toISOString().split('T')[0]; // yyyy-mm-dd

      if (!result[dateKey]) {
        result[dateKey] = { count: 0, users: [] };
      }

      result[dateKey].count += 1;

      // userUuid로 사용자 정보 조회
      const user = await this.userRepository.findOne({
        where: { userUuid: post.userUuid },
        select: ['userUuid', 'nickname', 'profileImage'],
      });

      if (user) {
        result[dateKey].users.push(user);
      }
    }

    return result;
  }

  /**
   * 챌린지 인증글의 검증 상태별 통계 조회
   */
  async getChallengeVerificationStats(challengeUuid: string) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 챌린지를 찾을 수 없습니다.',
      );
    }

    // 챌린지 인증글들의 검증 상태별 개수 조회
    const verificationStats = await this.postRepository
      .createQueryBuilder('post')
      .select('post.verificationStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('post.challengeUuid = :challengeUuid', { challengeUuid })
      .groupBy('post.verificationStatus')
      .getRawMany();

    const stats = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      review: 0,
    };

    verificationStats.forEach((stat) => {
      const count = parseInt(stat.count);
      stats.total += count;
      if (stat.status) {
        stats[stat.status] = count;
      }
    });

    return {
      message: '챌린지 검증 통계 조회 성공',
      challengeUuid,
      challengeTitle: challenge.title,
      verificationStats: stats,
    };
  }

  /**
   * 챌린지의 검토 필요한 인증글 목록 조회
   */
  async getChallengePostsForReview(
    challengeUuid: string,
    page: number = 1,
    limit: number = 10,
  ) {
    const challenge = await this.challengeRepository.findOne({
      where: { challengeUuid },
    });

    if (!challenge) {
      CustomException.throw(
        ErrorCode.CHALLENGE_NOT_FOUND,
        '해당 챌린지를 찾을 수 없습니다.',
      );
    }

    const [posts, total] = await this.postRepository.findAndCount({
      where: {
        challengeUuid,
        verificationStatus: 'review',
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    // 각 게시글의 사용자 정보와 AI 분석 결과 추가
    const postsWithDetails = await Promise.all(
      posts.map(async (post) => {
        const user = await this.userRepository.findOne({
          where: { userUuid: post.userUuid },
          select: ['userUuid', 'nickname', 'profileImage'],
        });

        return {
          ...post,
          user,
          aiAnalysisResult: post.aiAnalysisResult
            ? JSON.parse(post.aiAnalysisResult)
            : null,
        };
      }),
    );

    return {
      message: '검토 필요한 인증글 목록 조회 성공',
      challengeTitle: challenge.title,
      total,
      page,
      limit,
      posts: postsWithDetails,
    };
  }
}
