import { applyDecorators } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import {
  createErrorResponse,
  CommonAuthResponses,
  CommonErrorResponses,
} from '../../../decorators/swagger.decorator';
import { OnBoardingDto } from '../dto/onBoarding.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';

export function ApiOnboarding() {
  return applyDecorators(
    ApiOperation({
      summary: '온보딩 정보 입력',
      description: '회원가입 후 추가 정보(닉네임, 성별, 나이)를 입력합니다.',
    }),
    ApiBody({
      type: OnBoardingDto,
    }),
    ApiResponse({
      status: 201,
      description: '회원가입 완료',
      schema: {
        type: 'object',
        properties: {
          statusCode: { type: 'number', example: 201 },
          message: { type: 'string', example: '회원가입 완료' },
        },
      },
    }),
    ApiResponse(
      createErrorResponse('USER_001', '해당 사용자를 찾을 수 없습니다.', 404),
    ),
    ApiResponse(CommonErrorResponses.InternalServerError),
  );
}

export function ApiGetUserInfo() {
  return applyDecorators(
    ApiOperation({
      summary: '사용자 정보 조회',
      description: '사용자의 닉네임, 프로필 이미지, 소개글, UUID를 조회합니다.',
    }),
    ApiBearerAuth(),
    ApiResponse({
      status: 200,
      description: '사용자 정보 조회 성공',
      schema: {
        type: 'object',
        properties: {
          userName: { type: 'string', example: '홍길동' },
          userImage: {
            type: 'string',
            example: 'https://example.com/profile.jpg',
          },
          userIntroduction: { type: 'string', example: '안녕하세요!' },
          userUuid: { type: 'string', example: '01HZQ...' },
        },
      },
    }),
    ApiResponse(
      createErrorResponse('USER_001', '해당 사용자를 찾을 수 없습니다.', 404),
    ),
    ApiResponse(CommonAuthResponses.Unauthorized),
    ApiResponse(CommonErrorResponses.InternalServerError),
  );
}

export function ApiUpdateProfile() {
  return applyDecorators(
    ApiOperation({
      summary: '프로필 수정',
      description: '사용자의 닉네임, 소개글, 프로필 이미지를 수정합니다.',
    }),
    ApiBearerAuth(),
    ApiBody({ type: UpdateProfileDto }),
    ApiResponse({
      status: 200,
      description: '프로필 수정 성공',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: '프로필이 수정되었습니다.' },
        },
      },
    }),
    ApiResponse(
      createErrorResponse('USER_001', '해당 사용자를 찾을 수 없습니다.', 404),
    ),
    ApiResponse(CommonAuthResponses.Unauthorized),
    ApiResponse(CommonErrorResponses.ValidationFailed),
    ApiResponse(CommonErrorResponses.InternalServerError),
  );
}

/**
 * 로그아웃 API
 */
export function ApiLogout() {
  return applyDecorators(
    ApiOperation({
      summary: '로그아웃',
      description: '사용자를 로그아웃합니다.',
    }),
    ApiBearerAuth(),
    ApiResponse({
      status: 200,
      description: '로그아웃 성공',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: '로그아웃 성공' },
        },
      },
    }),
    ApiResponse(CommonAuthResponses.Unauthorized),
    ApiResponse(CommonErrorResponses.InternalServerError),
  );
}

export function ApiGetUserPosts() {
  return applyDecorators(
    ApiOperation({
      summary: '사용자 인증글 조회',
      description: '특정 사용자가 작성한 인증글 목록을 조회합니다.',
    }),
    ApiParam({
      name: 'userUuid',
      description: '사용자 UUID',
      example: '01HZQK5J8X2M3N4P5Q6R7S8T9V',
    }),
    ApiQuery({
      name: 'page',
      required: false,
      description: '페이지 번호 (기본값: 1)',
      example: 1,
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      description: '페이지당 항목 수 (기본값: 10)',
      example: 10,
    }),
    ApiResponse({
      status: 200,
      description: '사용자 인증글 조회 성공',
      schema: {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              userUuid: {
                type: 'string',
                example: '01HZQK5J8X2M3N4P5Q6R7S8T9V',
              },
              nickname: { type: 'string', example: '운동러버' },
              profileImage: {
                type: 'string',
                example: 'https://example.com/profile.jpg',
              },
              introduction: {
                type: 'string',
                example: '건강한 삶을 추구하는 운동 애호가입니다!',
              },
            },
          },
          posts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                postUuid: {
                  type: 'string',
                  example: '01HZQK5J8X2M3N4P5Q6R7S8T9V',
                },
                content: {
                  type: 'string',
                  example: '오늘 헬스장에서 2시간 운동했어요! 💪',
                },
                imageUrl: {
                  type: 'array',
                  items: { type: 'string' },
                  example: [
                    'https://soapft-bucket.s3.amazonaws.com/images/workout1.jpg',
                  ],
                },
                challenge: {
                  type: 'object',
                  properties: {
                    challengeUuid: {
                      type: 'string',
                      example: '01HZQK5J8X2M3N4P5Q6R7S8T9V',
                    },
                    title: { type: 'string', example: '30일 헬스 챌린지' },
                  },
                },
                likeCount: { type: 'number', example: 15 },
                commentCount: { type: 'number', example: 3 },
                createdAt: {
                  type: 'string',
                  format: 'date-time',
                  example: '2025-06-22T12:00:00Z',
                },
              },
            },
          },
          pagination: {
            type: 'object',
            properties: {
              currentPage: { type: 'number', example: 1 },
              totalPages: { type: 'number', example: 5 },
              totalItems: { type: 'number', example: 50 },
              itemsPerPage: { type: 'number', example: 10 },
            },
          },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: '사용자를 찾을 수 없음',
    }),
  );
}

export function ApiGetOtherUserInfo() {
  return applyDecorators(
    ApiOperation({
      summary: '다른 사용자 정보 조회',
      description:
        '특정 사용자의 닉네임, 프로필 이미지, 소개글, 게시글 수, 친구 수를 조회합니다.',
    }),
    ApiParam({
      name: 'userUuid',
      description: '조회할 사용자 UUID',
      example: '01HZQK5J8X2M3N4P5Q6R7S8T9V',
    }),
    ApiResponse({
      status: 200,
      description: '사용자 정보 조회 성공',
      schema: {
        type: 'object',
        properties: {
          userName: { type: 'string', example: '상냥한너구리' },
          userImage: {
            type: 'string',
            example: 'https://example.com/profile.jpg',
          },
          userIntroduction: { type: 'string', example: '안녕하세요!' },
          userUuid: { type: 'string', example: '01HZQK5J8X2M3N4P5Q6R7S8T9V' },
          postCount: { type: 'number', example: 5 },
          friendCount: { type: 'number', example: 10 },
        },
      },
    }),
    ApiResponse({
      status: 404,
      description: '사용자를 찾을 수 없습니다.',
      schema: {
        type: 'object',
        properties: {
          errorCode: { type: 'string', example: 'USER_001' },
          message: {
            type: 'string',
            example: '해당 사용자를 찾을 수 없습니다.',
          },
        },
      },
    }),
  );
}

export function ApiDeleteUser() {
  return applyDecorators(
    ApiOperation({
      summary: '회원 탈퇴',
      description:
        '사용자 계정을 익명화(닉네임, 소셜 ID, 프로필 이미지 등 민감 정보 제거) 처리하여 탈퇴합니다.',
    }),
    ApiBearerAuth(),
    ApiResponse({
      status: 200,
      description: '회원 탈퇴 성공',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string', example: '회원 탈퇴 성공!' },
        },
      },
    }),
    ApiResponse(
      createErrorResponse('USER_001', '해당 사용자를 찾을 수 없습니다.', 404),
    ),
    ApiResponse(CommonAuthResponses.Unauthorized),
    ApiResponse(CommonErrorResponses.InternalServerError),
  );
}
