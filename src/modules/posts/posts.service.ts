/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Post } from '@/entities/post.entity';
import { CustomException } from '@/utils/custom-exception';
import { ErrorCode } from '@/types/error-code.enum';
import { LikesService } from '@/modules/likes/likes.service';
import { CommentsService } from '../comments/comments.service';
import { ChallengeService } from '../challenges/challenge.service';
import { User } from '@/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ulid } from 'ulid';
import { Comment } from '@/entities/comment.entity';
import { Suspicion } from '@/entities/suspicion.entity';
import { Like } from '@/entities/like.entity';
import { ImageVerification } from '@/entities/image-verification.entity';
import { AiService, ImageAnalysisResult } from '../ai/ai.service';
import { Challenge } from '@/entities/challenge.entity';
import { UploadsService } from '../uploads/uploads.service';
import { JwtService } from '@nestjs/jwt';
import { S3Service } from '../s3/s3.service';
import { SqsService } from '../sqs/sqs.service';
import { ChatbotService } from '../chatbot/chatbot.service';
import axios from 'axios';

@Injectable()
export class PostsService {
  constructor(
    @InjectRepository(Post)
    private postRepository: Repository<Post>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Comment)
    private commentRepository: Repository<Comment>,
    @InjectRepository(Suspicion)
    private suspicionRepository: Repository<Suspicion>,
    @InjectRepository(Like)
    private likeRepository: Repository<Like>,
    @InjectRepository(ImageVerification)
    private imageVerificationRepository: Repository<ImageVerification>,
    @InjectRepository(Challenge)
    private challengeRepository: Repository<Challenge>,

    private likesService: LikesService,
    @Inject(forwardRef(() => CommentsService))
    private commentsService: CommentsService,
    @Inject(forwardRef(() => ChallengeService))
    private challengeService: ChallengeService,
    private userService: UsersService,
    private aiService: AiService,
    private s3Service: S3Service,
    private sqsService: SqsService,
    private jwtService: JwtService,
    private chatbotService: ChatbotService,
  ) {}

  /**
   * 게시글 생성 전 이미지 AI 검증
   */
  async precheckImagesForChallenge(
    challengeUuid: string,
    images: Express.Multer.File[],
    userUuid: string,
  ) {
    try {
      console.log(
        `이미지 사전 검증 시작 - 사용자: ${userUuid}, 챌린지: ${challengeUuid}`,
      );

      // 1. 챌린지 정보 조회
      const challenge = await this.challengeRepository.findOne({
        where: { challengeUuid },
      });

      if (!challenge) {
        throw new Error('챌린지를 찾을 수 없습니다.');
      }

      // 2. 이미지 검증 (크기, 형식 등)
      if (!images || images.length === 0) {
        throw new Error('이미지가 필요합니다.');
      }

      if (images.length > 5) {
        throw new Error('최대 5개의 이미지만 업로드할 수 있습니다.');
      }

      // 3. S3에 이미지 업로드
      const uploadResults = await Promise.all(
        images.map(async (image, index) => {
          try {
            // S3 업로드
            const imageUrl = await this.s3Service.uploadImage(image);

            return {
              success: true,
              imageUrl: imageUrl,
              originalName: image.originalname,
              size: image.size,
            };
          } catch (error) {
            console.error(`이미지 ${index} 업로드 실패:`, error);
            return {
              success: false,
              error: error.message,
              originalName: image.originalname,
            };
          }
        }),
      );

      // 업로드 실패한 이미지가 있는지 확인
      const failedUploads = uploadResults.filter((result) => !result.success);
      if (failedUploads.length > 0) {
        throw new Error(
          `이미지 업로드 실패: ${failedUploads.map((f) => f.originalName).join(', ')}`,
        );
      }

      // 4. 임시 Post UUID 생성
      const postUuid = ulid();

      // 5. image_verification 테이블에 레코드 생성하고 SQS에 메시지 전송
      const verificationTasks = [];
      const verificationRecords = [];

      for (const uploadResult of uploadResults) {
        // image_verification 테이블에 초기 상태로 저장
        const verification = this.imageVerificationRepository.create({
          postUuid: postUuid,
          imageUrl: uploadResult.imageUrl,
          isRelevant: false,
          confidence: 0,
          reasoning: '검증 대기 중...',
          suggestedAction: 'reject',
          status: 'pending',
        });

        const savedVerification =
          await this.imageVerificationRepository.save(verification);
        verificationRecords.push(savedVerification);

        // SQS 메시지 준비
        verificationTasks.push({
          verificationId: savedVerification.id,
          postUuid: postUuid,
          imageUrl: uploadResult.imageUrl,
          challengeTitle: challenge.title,
          challengeDescription: challenge.introduce,
          verificationGuide: challenge.verificationGuide,
        });
      }

      // 6. SQS로 배치 메시지 전송 (비동기 처리)
      await this.sqsService.sendBatchImageVerificationTasks(verificationTasks);

      // 7. 검증 토큰 생성 (게시글 생성 시 보안용)
      const verificationToken = this.jwtService.sign(
        {
          postUuid,
          userUuid,
          challengeUuid,
          createdAt: new Date().toISOString(),
        },
        {
          expiresIn: '24h', // 24시간 유효
        },
      );

      // 8. 즉시 응답 반환 (비동기 처리 시작됨)
      const response = {
        success: true,
        message: '이미지 검증이 시작되었습니다. 잠시 후 상태를 확인해주세요.',
        postUuid,
        verificationToken, // 게시글 생성 시 필요한 토큰
        overallStatus: 'processing',
        canCreatePost: false,
        totalImages: uploadResults.length,
        pendingImages: uploadResults.length,
        approvedImages: 0,
        rejectedImages: 0,
        reviewImages: 0,
        averageConfidence: 0,
        images: verificationRecords.map((record) => ({
          imageUrl: record.imageUrl,
          status: record.status,
          confidence: record.confidence,
          reasoning: record.reasoning,
          isRelevant: record.isRelevant,
        })),
        recommendedAction: 'AI 검증이 진행 중입니다. 잠시만 기다려주세요.',
      };

      return response;
    } catch (error) {
      console.error('이미지 사전 검증 실패:', error);

      return {
        success: false,
        message: error.message || '이미지 검증 중 오류가 발생했습니다.',
        canCreatePost: false,
      };
    }
  }

  /**
   * 이미지 검증 상태 확인 (폴링용)
   */
  async checkVerificationStatus(postUuid: string, userUuid: string) {
    try {
      // image_verification 테이블에서 해당 postUuid의 모든 검증 상태 조회
      const verifications = await this.imageVerificationRepository.find({
        where: { postUuid },
        order: { createdAt: 'ASC' },
      });

      if (!verifications || verifications.length === 0) {
        throw new Error('검증 정보를 찾을 수 없습니다.');
      }

      // 이미지별 상태 정리
      const imageStatuses = verifications.map((v) => ({
        imageUrl: v.imageUrl,
        status: v.status,
        confidence: v.confidence,
        reasoning: v.reasoning,
        isRelevant: v.isRelevant,
      }));

      // 전체 상태 계산
      const pendingCount = verifications.filter(
        (v) => v.status === 'pending',
      ).length;
      const approvedCount = verifications.filter(
        (v) => v.status === 'approved',
      ).length;
      const rejectedCount = verifications.filter(
        (v) => v.status === 'rejected',
      ).length;
      const reviewCount = verifications.filter(
        (v) => v.status === 'review',
      ).length;

      let overallStatus = 'processing';
      let canCreatePost = false;

      if (pendingCount === 0) {
        // 모든 검증이 완료됨
        if (approvedCount === verifications.length) {
          overallStatus = 'approved';
          canCreatePost = true;
        } else if (rejectedCount > 0) {
          overallStatus = 'rejected';
        } else if (reviewCount > 0) {
          overallStatus = 'review';
        }
      }

      // 평균 신뢰도 계산
      const averageConfidence =
        verifications.length > 0
          ? Math.round(
              verifications.reduce((sum, v) => sum + v.confidence, 0) /
                verifications.length,
            )
          : 0;

      // 승인된 이미지 URL 목록 (게시글 생성 시 사용)
      const approvedImageUrls = verifications
        .filter((v) => v.status === 'approved')
        .map((v) => v.imageUrl);

      return {
        success: true,
        postUuid,
        overallStatus,
        canCreatePost,
        totalImages: verifications.length,
        pendingImages: pendingCount,
        approvedImages: approvedCount,
        rejectedImages: rejectedCount,
        reviewImages: reviewCount,
        averageConfidence,
        approvedImageUrls, // 승인된 이미지 URL 목록
        images: imageStatuses,
        recommendedAction: this.getRecommendedAction(
          overallStatus,
          approvedCount,
          rejectedCount,
          reviewCount,
        ),
      };
    } catch (error) {
      console.error('검증 상태 확인 실패:', error);
      throw error;
    }
  }

  /**
   * 권장 액션 메시지 생성
   */
  private getRecommendedAction(
    overallStatus: string,
    approvedCount: number,
    rejectedCount: number,
    reviewCount: number,
  ): string {
    switch (overallStatus) {
      case 'processing':
        return 'AI 검증이 진행 중입니다. 잠시만 기다려주세요.';
      case 'approved':
        return '모든 이미지가 승인되었습니다. 게시글을 생성할 수 있습니다.';
      case 'rejected':
        if (rejectedCount === 1) {
          return '일부 이미지가 챌린지와 관련이 없습니다. 다른 이미지로 다시 시도해주세요.';
        }
        return `${rejectedCount}개 이미지가 챌린지와 관련이 없습니다. 다른 이미지로 다시 시도해주세요.`;
      case 'review':
        return '일부 이미지가 수동 검토가 필요합니다. 관리자의 검토를 기다려주세요.';
      default:
        return '검증 상태를 확인할 수 없습니다.';
    }
  }

  /**
   * AI 검증 완료된 이미지로 게시글 생성
   */
  async createVerifiedPost(
    createVerifiedPostDto: {
      title: string;
      content: string;
      challengeUuid: string;
      verifiedImageUrls: string[];
      verificationToken: string;
      isPublic?: boolean;
    },
    userUuid: string,
  ) {
    try {
      // 1. 검증 토큰 확인
      const tokenPayload = this.jwtService.verify(
        createVerifiedPostDto.verificationToken,
      );

      if (tokenPayload.userUuid !== userUuid) {
        throw new Error('유효하지 않은 검증 토큰입니다.');
      }

      if (tokenPayload.challengeUuid !== createVerifiedPostDto.challengeUuid) {
        throw new Error('챌린지 정보가 일치하지 않습니다.');
      }

      // 2. 게시글 생성
      const postUuid = ulid();
      const post = this.postRepository.create({
        postUuid,
        userUuid,
        challengeUuid: createVerifiedPostDto.challengeUuid,
        title: createVerifiedPostDto.title,
        content: createVerifiedPostDto.content,
        imageUrl: createVerifiedPostDto.verifiedImageUrls,
        isPublic: createVerifiedPostDto.isPublic ?? true,
        verificationStatus: 'approved', // 이미 검증 완료
        aiConfidence: 100, // 검증 통과
        verifiedAt: new Date(),
        createdAt: new Date(),
      });

      const savedPost = await this.postRepository.save(post);

      // 3. 챌린지 게시글인 경우 챗봇 알림 전송
      if (createVerifiedPostDto.challengeUuid) {
        this.chatbotService
          .sendAuthCompletionMessage(
            userUuid,
            createVerifiedPostDto.challengeUuid,
            savedPost.postUuid,
          )
          .catch((error) => {
            console.error('챗봇 알림 전송 실패:', error);
          });

        // 모든 참여자가 인증했는지 확인하고 축하 메시지 전송
        this.chatbotService
          .checkAllParticipantsAuthenticated(
            createVerifiedPostDto.challengeUuid,
          )
          .then((allAuthenticated) => {
            if (allAuthenticated) {
              this.chatbotService
                .sendGroupCompletionMessage(createVerifiedPostDto.challengeUuid)
                .catch((error) => {
                  console.error('그룹 완료 메시지 전송 실패:', error);
                });
            }
          })
          .catch((error) => {
            console.error('참여자 인증 상태 확인 실패:', error);
          });
      }

      return {
        success: true,
        message: '게시글이 성공적으로 생성되었습니다.',
        post: savedPost,
      };
    } catch (error) {
      console.error('검증된 게시글 생성 실패:', error);
      throw new Error(`게시글 생성 실패: ${error.message}`);
    }
  }

  /**
   * AI 분석 결과에 따른 사용자 권장사항 생성
   */
  private getRecommendations(
    overallResult: string,
    analysisResults: any[],
  ): string[] {
    const recommendations: string[] = [];

    if (overallResult === 'approved') {
      recommendations.push('모든 이미지가 챌린지와 관련이 있습니다.');
      recommendations.push('이제 게시글을 작성하실 수 있습니다.');
    } else if (overallResult === 'rejected') {
      recommendations.push('일부 이미지가 챌린지와 관련이 없습니다.');

      const rejectedImages = analysisResults.filter(
        (r) => r.analysis.suggestedAction === 'reject',
      );
      if (rejectedImages.length > 0) {
        recommendations.push(
          `관련성이 낮은 이미지: ${rejectedImages.map((r) => r.originalName).join(', ')}`,
        );
      }

      recommendations.push('챌린지 가이드에 맞는 이미지로 다시 촬영해주세요.');
    } else {
      recommendations.push('일부 이미지가 명확하지 않습니다.');
      recommendations.push(
        '더 명확한 사진을 촬영하거나, 관리자 검토를 기다려주세요.',
      );
    }

    return recommendations;
  }

  /**
   * 기존 게시물 생성
   */
  async createPost(dto: CreatePostDto, userUuid: string) {
    const newPost = this.postRepository.create({
      postUuid: ulid(),
      title: dto.title,
      userUuid,
      challengeUuid: dto.challengeUuid,
      content: dto.content,
      imageUrl: dto.imageUrl,
      isPublic: dto.isPublic ?? true,
      verificationStatus: dto.challengeUuid ? 'pending' : 'approved', // 챌린지 글이면 pending, 일반 글이면 approved
    });

    await this.postRepository.save(newPost);

    // 챌린지 게시글인 경우 챗봇 알림 전송
    if (dto.challengeUuid) {
      this.chatbotService
        .sendAuthCompletionMessage(
          userUuid,
          dto.challengeUuid,
          newPost.postUuid,
        )
        .catch((error) => {
          console.error('챗봇 알림 전송 실패:', error);
        });

      // 모든 참여자가 인증했는지 확인하고 축하 메시지 전송
      this.chatbotService
        .checkAllParticipantsAuthenticated(dto.challengeUuid)
        .then((allAuthenticated) => {
          if (allAuthenticated) {
            this.chatbotService
              .sendGroupCompletionMessage(dto.challengeUuid)
              .catch((error) => {
                console.error('그룹 완료 메시지 전송 실패:', error);
              });
          }
        })
        .catch((error) => {
          console.error('참여자 인증 상태 확인 실패:', error);
        });
    }

    return {
      message: '게시물이 생성되었습니다.',
      post: newPost,
    };
  }

  // 게시물 수정
  async updatePost(postUuid: string, dto: UpdatePostDto, userUuid: string) {
    const post = await this.postRepository.findOne({
      where: { postUuid },
    });

    if (!post) {
      CustomException.throw(
        ErrorCode.POST_NOT_FOUND,
        '해당 게시글이 없습니다.',
      );
    }

    if (post.userUuid !== userUuid) {
      CustomException.throw(
        ErrorCode.POST_ACCESS_DENIED,
        '해당 포스트에 접근할 수 없습니다.',
      );
    }

    if (dto.title !== undefined) post.title = dto.title;
    if (dto.content !== undefined) post.content = dto.content;
    if (dto.imageUrl !== undefined) post.imageUrl = dto.imageUrl;
    if (dto.isPublic !== undefined) post.isPublic = dto.isPublic;

    await this.postRepository.save(post);

    return {
      message: '게시글이 수정되었습니다.',
      post,
    };
  }

  // 자신의 게시글 조회
  async getPostsByUserUuid(userUuid: string, page = 1, limit = 10) {
    const [posts, total] = await this.postRepository.findAndCount({
      where: { userUuid },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      message: '사용자 게시글 조회 성공',
      total,
      page,
      limit,
      posts,
    };
  }

  // 특정 사용자 게시글 목록 조회
  async getUserPosts(userUuid: string, page: number, limit: number) {
    const [posts, total] = await this.postRepository.findAndCount({
      where: { userUuid },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      message: '사용자 게시글 목록 조회 성공',
      total,
      page,
      limit,
      posts,
    };
  }

  // 게시글 상세 조회
  async getPostDetail(postUuid: string, userUuid: string) {
    const post = await this.postRepository.findOne({
      where: { postUuid },
    });

    if (!post) {
      CustomException.throw(
        ErrorCode.POST_NOT_FOUND,
        '해당 게시글을 찾을 수 없습니다.',
      );
    }

    post.views += 1;
    await this.postRepository.save(post);

    // 사용자 정보 조회
    const user = await this.userRepository.findOne({
      where: { userUuid: post.userUuid },
      select: ['userUuid', 'nickname', 'profileImage'],
    });

    // 좋아요 수
    const likeCount = await this.likeRepository.count({
      where: { postUuid },
    });

    // 내가 좋아요 했는지 여부
    const liked = await this.likeRepository.findOne({
      where: { postUuid, userUuid },
    });

    // 의심 수
    const suspicionCount = await this.suspicionRepository.count({
      where: { postUuid },
    });
    // 내가 의심했는지 여부
    const suspicious = await this.suspicionRepository.findOne({
      where: { postUuid, userUuid },
    });

    return {
      message: '게시글 상세 조회 성공',
      post: {
        id: post.id,
        postUuid: post.postUuid,
        title: post.title,
        challengeUuid: post.challengeUuid,
        content: post.content,
        imageUrl: post.imageUrl,
        isPublic: post.isPublic,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        userUuid: post.userUuid,
        isMine: post.userUuid === userUuid,
        views: post.views,
        user: user
          ? {
              userUuid: user.userUuid,
              nickname: user.nickname,
              profileImage: user.profileImage,
            }
          : null,
        likeCount,
        isLiked: !!liked,
        suspicionCount,
        isSuspicious: !!suspicious,
      },
    };
  }

  // 게시글 삭제
  async deletePost(postUuid: string, userUuid: string) {
    const post = await this.postRepository.findOne({
      where: { postUuid },
    });

    if (!post) {
      CustomException.throw(
        ErrorCode.POST_NOT_FOUND,
        '해당 게시글을 찾을 수 없습니다.',
      );
    }

    if (post.userUuid !== userUuid) {
      CustomException.throw(
        ErrorCode.POST_ACCESS_DENIED,
        '해당 게시글을 삭제할 권한이 없습니다.',
      );
    }

    await this.postRepository.remove(post);

    return {
      message: '게시글이 삭제되었습니다.',
    };
  }

  // 그룹 게시글 조회
  async getPostsByChallenge(
    challengeUuid: string,
    page: number,
    limit: number,
  ) {
    const [posts, total] = await this.postRepository.findAndCount({
      where: { challengeUuid },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const postUuids = posts.map((post) => post.postUuid);

    if (postUuids.length === 0) {
      return {
        message: '챌린지 게시글 목록 조회 성공',
        total,
        page,
        limit,
        posts: [],
      };
    }

    const likeCounts =
      await this.likesService.getLikeCountsByPostIds(postUuids);

    const commentCountsArray = await this.commentRepository
      .createQueryBuilder('comment')
      .select('comment.postUuid', 'postUuid')
      .addSelect('COUNT(comment.id)', 'count')
      .where('comment.postUuid IN (:...postUuids)', { postUuids })
      .groupBy('comment.postUuid')
      .getRawMany();

    const commentCounts = new Map<string, number>();
    commentCountsArray.forEach((c) =>
      commentCounts.set(c.postUuid, parseInt(c.count)),
    );

    // 각 게시글의 userUuid로 사용자 정보 조회 후 병합
    const postsWithUserAndLike = await Promise.all(
      posts.map(async (post) => {
        const user = await this.userRepository.findOne({
          where: { userUuid: post.userUuid },
          select: ['userUuid', 'nickname', 'profileImage'],
        });

        return {
          ...post,
          user: user
            ? {
                userUuid: user.userUuid,
                nickname: user.nickname,
                profileImage: user.profileImage,
              }
            : null,
          likeCount: likeCounts.get(post.postUuid) || 0,
          commentCount: commentCounts.get(post.postUuid) || 0,
        };
      }),
    );

    return {
      message: '챌린지 게시글 목록 조회 성공',
      total,
      page,
      limit,
      posts: postsWithUserAndLike,
    };
  }

  async getUserCalendar(userUuid: string, year: number, month: number) {
    const posts = await this.postRepository.find({
      where: {
        userUuid,
        createdAt: Between(
          new Date(`${year}-${month}-01`),
          new Date(`${year}-${month}-31`),
        ),
      },
      select: ['postUuid', 'imageUrl', 'createdAt'],
    });

    // 날짜별 그룹핑
    const grouped = posts.reduce((acc, post) => {
      const date = post.createdAt.toISOString().split('T')[0];
      if (!acc[date]) acc[date] = [];
      acc[date].push({
        postUuid: post.postUuid,
        imageUrl: post.imageUrl,
      });
      return acc;
    }, {});

    return Object.entries(grouped).map(([date, posts]) => ({
      date,
      posts,
    }));
  }

  async reportSuspiciousPost(userUuid: string, postUuid: string) {
    const existing = await this.suspicionRepository.findOne({
      where: { userUuid, postUuid },
    });

    if (existing) {
      CustomException.throw(
        ErrorCode.ALREADY_REPORTED,
        '이미 의심한 게시글입니다.',
      );
    }

    const report = this.suspicionRepository.create({ userUuid, postUuid });
    await this.suspicionRepository.save(report);

    return { message: '의심하기 완료' };
  }

  /**
   * 이미지 URL을 base64로 변환
   */
  private async imageUrlToBase64(imageUrl: string): Promise<string> {
    try {
      const response = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SOAPFT-Bot/1.0)',
        },
      });
      const base64 = Buffer.from(response.data, 'binary').toString('base64');
      return base64;
    } catch (error) {
      console.error('이미지 다운로드 실패:', imageUrl, error);
      throw new Error(`이미지를 다운로드할 수 없습니다: ${imageUrl}`);
    }
  }

  /**
   * 게시글의 검증 상태 조회
   */
  async getPostVerificationStatus(postUuid: string) {
    const post = await this.postRepository.findOne({
      where: { postUuid },
      select: [
        'postUuid',
        'verificationStatus',
        'aiConfidence',
        'aiAnalysisResult',
        'verifiedAt',
      ],
    });

    if (!post) {
      CustomException.throw(
        ErrorCode.POST_NOT_FOUND,
        '해당 게시글을 찾을 수 없습니다.',
      );
    }

    const imageVerifications = await this.imageVerificationRepository.find({
      where: { postUuid },
      order: { createdAt: 'ASC' },
    });

    return {
      message: '검증 상태 조회 성공',
      verification: {
        postUuid: post.postUuid,
        status: post.verificationStatus,
        confidence: post.aiConfidence,
        verifiedAt: post.verifiedAt,
        analysisResult: post.aiAnalysisResult
          ? JSON.parse(post.aiAnalysisResult)
          : null,
        imageVerifications,
      },
    };
  }
}
