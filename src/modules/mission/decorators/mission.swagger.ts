import { applyDecorators } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { CreateMissionDto } from '../dto/create-mission.dto';
import { UpdateMissionDto } from '../dto/update-mission.dto';

export function ApiCreateMission() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 생성',
      description: '관리자가 새로운 미션을 생성합니다.',
    }),
    ApiBody({
      type: CreateMissionDto,
      examples: {
        default: {
          summary: '예시',
          value: {
            title: '7월 런닝 미션',
            description: '일주일 간 20km 달리기',
            type: 'distance',
            startTime: '2025-08-09T00:00:00Z',
            endTime: '2025-08-09T23:59:59Z',
            durationSeconds: 3600,
            reward: 20,
            isLongTerm: false,
            rewardTopN: 5,
          },
        },
        longTerm: {
          summary: '장기 챌린지 예시',
          value: {
            title: '8월 건강 챌린지',
            description: '한 달 동안 하루 8000보 걷기',
            type: 'steps',
            startTime: '2025-08-13T00:00:00Z',
            endTime: '2025-08-18T23:59:59Z',
            reward: 20,
            isLongTerm: true,
            rewardTopN: 5,
          },
        },
      },
    }),
    ApiResponse({ status: 201, description: '미션 생성 성공' }),
    ApiResponse({ status: 400, description: '잘못된 요청' }),
  );
}

export function ApiUpdateMission() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 수정',
      description: '기존 미션 정보를 수정합니다.',
    }),
    ApiParam({ name: 'id', description: '미션 ID', example: '1' }),
    ApiBody({
      type: UpdateMissionDto,
      examples: {
        default: {
          summary: '예시',
          value: {
            title: '수정된 런닝 미션',
            reward: 1500,
          },
        },
      },
    }),
    ApiResponse({ status: 200, description: '수정 성공' }),
    ApiResponse({ status: 404, description: '미션을 찾을 수 없음' }),
  );
}

export function ApiDeleteMission() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 삭제',
      description: '특정 미션을 삭제합니다.',
    }),
    ApiParam({ name: 'id', description: '미션 ID', example: '1' }),
    ApiResponse({ status: 200, description: '삭제 성공' }),
    ApiResponse({ status: 404, description: '미션을 찾을 수 없음' }),
  );
}

export function ApiGetMissionDetail() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 상세 조회',
      description: '미션 상세 정보와 사용자 랭킹 정보를 함께 반환합니다.',
    }),
    ApiParam({ name: 'id', description: '미션 ID', example: '1' }),
    ApiResponse({
      status: 200,
      description: '조회 성공',
      schema: {
        example: {
          mission: {
            id: '5',
            title: '8월 운동 미션',
            description: '하루동안 칼로리 많이 소모하기',
            type: 'calories',
            startTime: '2025-08-10T15:00:00.000Z',
            endTime: '2025-08-12T14:59:59.000Z',
            durationSeconds: 86400,
            reward: 20,
            isLongTerm: true,
            rewardTopN: null,
            createdAt: '2025-08-10T03:54:54.693Z',
            rewardsDistributed: false,
          },
          isParticipating: false,
          myResult: null,
          myRank: null,
          myName: null,
          myProfileImage: null,
          rankings: [
            {
              userUuid: '01K26XZ0W6E635A9F3G27ZP70C',
              name: '꿈꾸는 양배추',
              profileImage:
                'https://nullisdefined.s3.ap-northeast-2.amazonaws.com/images/d06fa637a7bc403b5531305594791aaa.png',
              result: 350,
            },
            {
              userUuid: '01K2H6ZRYSCRYVTRJZPE6G51WK',
              name: '무서운 딸기',
              profileImage: null,
              result: 0,
            },
            {
              userUuid: '01K26NRFRBW8J5MH9ZSQESQ7DP',
              name: '깔끔한 사과',
              profileImage:
                'https://nullisdefined.s3.ap-northeast-2.amazonaws.com/images/d06fa637a7bc403b5531305594791aaa.png',
              result: 0,
            },
          ],
          status: 'COMPLETED',
        },
      },
    }),
    ApiResponse({ status: 404, description: '미션을 찾을 수 없음' }),
  );
}

export function ApiGetAllMissions() {
  return applyDecorators(
    ApiOperation({
      summary: '전체 미션 목록 조회',
      description: '등록된 전체 미션 목록을 조회합니다.',
    }),
    ApiResponse({ status: 200, description: '조회 성공' }),
  );
}

export function ApiParticipateMission() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 참여',
      description: '사용자가 특정 미션에 참여합니다.',
    }),
    ApiParam({ name: 'missionId', description: '미션 ID', example: '1' }),
    ApiResponse({ status: 201, description: '참여 성공' }),
    ApiResponse({ status: 404, description: '미션 또는 사용자 정보 없음' }),
  );
}

export function ApiSubmitMissionResult() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 결과 제출',
      description:
        '사용자가 완료한 미션 데이터를 제출합니다. 미션 기간(시작~종료) 내에만 제출할 수 있습니다.',
    }),
    ApiParam({
      name: 'missionId',
      description: '미션 ID',
      example: '1',
    }),
    ApiBody({
      schema: {
        type: 'object',
        properties: {
          resultData: {
            type: 'number',
            example: 120,
            description: '제출한 미션 결과 값 (예: 걸음 수, 거리 등)',
          },
        },
        required: ['resultData'],
      },
    }),
    // 성공
    ApiResponse({
      status: 200,
      description: '제출 성공',
      schema: {
        example: {
          id: '123',
          missionId: '1',
          userUuid: '01JYKVN18MCW5B9FZ1PP7T14XS',
          resultData: 120,
          completed: true,
          createdAt: '2025-09-03T12:34:56.000Z',
          updatedAt: '2025-09-03T12:35:10.000Z',
        },
      },
    }),
    // 참여 정보 없음
    ApiResponse({
      status: 404,
      description: '참여 정보 없음',
      schema: {
        example: {
          errorCode: 'NOT_FOUND',
          message: '해당 미션에 참여한 기록이 없습니다.',
          timestamp: '2025-09-03T12:35:10.000Z',
          details: { missionId: '1' },
        },
      },
    }),
    // 아직 시작 전
    ApiResponse({
      status: 400,
      description: '미션 시작 전 제출 불가',
      schema: {
        example: {
          errorCode: 'CHALLENGE_NOT_STARTED',
          message: '아직 미션이 시작되지 않았습니다.',
          timestamp: '2025-09-03T12:35:10.000Z',
          details: { missionId: '1', startTime: '2025-09-10T00:00:00.000Z' },
        },
      },
    }),
    // 이미 종료됨
    ApiResponse({
      status: 400,
      description: '미션 종료 후 제출 불가',
      schema: {
        example: {
          errorCode: 'CHALLENGE_ALREADY_FINISHED',
          message: '챌린지가 이미 종료되었습니다.',
          timestamp: '2025-09-03T12:35:10.000Z',
          details: { missionId: '1', endTime: '2025-09-01T23:59:59.000Z' },
        },
      },
    }),
  );
}

export function ApiGetMyMissions() {
  return applyDecorators(
    ApiOperation({
      summary: '내 미션 목록 조회',
      description: '내가 참여한 미션들을 조회합니다.',
    }),
    ApiResponse({ status: 200, description: '조회 성공' }),
  );
}

export function ApiCancelMissionParticipation() {
  return applyDecorators(
    ApiOperation({
      summary: '미션 참여 취소',
      description: '사용자가 참여했던 미션을 취소합니다.',
    }),
    ApiParam({ name: 'id', description: '미션 ID', example: '1' }),
    ApiResponse({ status: 200, description: '참여 취소 성공' }),
    ApiResponse({ status: 404, description: '참여 기록 없음' }),
  );
}
