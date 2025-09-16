import { Auth } from '@/entities/auth.entity';
import { User } from '@/entities/user.entity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post } from '@/entities/post.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserStatusType } from '@/types/user-status.enum';
import { OnBoardingDto } from './dto/onBoarding.dto';
import { CustomException } from '@/utils/custom-exception';
import { ErrorCode } from '@/types/error-code.enum';
import { Friendship } from '@/entities/friendship.entity';
import { FriendshipStatus } from '@/types/friendship.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Auth)
    private authRepository: Repository<Auth>,
    @InjectRepository(Post)
    private postRepository: Repository<Post>,
    @InjectRepository(Friendship)
    private friendshipRepository: Repository<Friendship>,
  ) {}

  /**
   * 나이 계산 함수
   * @param birthDate
   * @returns
   */
  calculateAge(birthDate: Date | string): number {
    const dateObj = birthDate instanceof Date ? birthDate : new Date(birthDate);
    const today = new Date();
    return today.getFullYear() - dateObj.getFullYear() + 1;
  }

  findOneBySocialId(socialId: string) {
    return this.userRepository.findOneBy({ socialId });
  }

  findOneByNickname(nickname: string) {
    return this.userRepository.findOneBy({ nickname });
  }

  createUser(user, uuid): Promise<User> {
    const newUser = this.userRepository.create({
      userUuid: uuid,
      nickname: user.nickname,
      socialNickname: user.socialNickname,
      profileImage: user.profileImage,
      socialProvider: user.socialProvider,
      socialId: user.socialId,
      pushToken: user.pushToken,
      coins: 20,
      status: UserStatusType.INCOMPLETE,
    });
    return this.userRepository.save(newUser);
  }

  /**
   * userUuid로 userUuid 조회
   * @param userUuid 사용자 UUID
   * @returns 사용자 ID
   */
  async getUserIdByUuid(userUuid: string): Promise<number> {
    const user = await this.userRepository.findOne({
      where: { userUuid },
      select: ['id'],
    });

    if (!user) {
      throw new NotFoundException(
        `UUID ${userUuid}에 해당하는 사용자를 찾을 수 없습니다.`,
      );
    }

    return user.id;
  }

  /**
   * userUuid로 사용자 전체 정보 조회
   * @param userUuid 사용자 UUID
   * @returns User 엔티티 (없으면 NotFoundException 발생)
   */
  async getUserByUuid(userUuid: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { userUuid },
    });

    if (!user) {
      throw new NotFoundException(
        `UUID ${userUuid}에 해당하는 사용자를 찾을 수 없습니다.`,
      );
    }

    return user;
  }

  // 최초 회원가입 후 추가 정보 입력
  async completeOnboarding(userUuid: string, dto: OnBoardingDto) {
    const user = await this.userRepository.findOne({ where: { userUuid } });
    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 사용자를 찾을 수 없습니다.',
      );
    }

    user.nickname = dto.nickname;
    user.gender = dto.gender;
    user.birthDate = dto.birthDate;
    user.status = UserStatusType.ACTIVE;

    await this.userRepository.save(user);
    return {
      statusCode: 201,
      message: '회원가입 완료',
    };
  }

  async logout(userUuid: string) {
    await this.authRepository.update(
      { userUuid },
      {
        refreshToken: null,
      },
    );

    return {
      message: '로그아웃 성공',
    };
  }

  /*
  닉네임, 소개글 변경
  */
  async updateProfile(userUuid: string, dto: UpdateProfileDto) {
    const { newNickname, newIntroduction, newProfileImg } = dto;

    const user = await this.userRepository.findOneBy({ userUuid });
    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 사용자를 찾을 수 없습니다.',
      );
    }

    if (newNickname !== undefined) {
      user.nickname = newNickname;
    }
    if (newIntroduction !== undefined) {
      user.introduction = newIntroduction;
    }
    if (newProfileImg !== undefined) {
      user.profileImage = newProfileImg;
    }

    await this.userRepository.save(user);

    return { message: '프로필이 수정되었습니다.' };
  }

  async checkUserExists(userUuid: string): Promise<boolean> {
    const user = await this.userRepository.findOne({ where: { userUuid } });
    return !!user;
  }

  async getUserByIds(idArray: string[]) {
    const users = await Promise.all(
      idArray.map(async (id) => {
        const user = await this.userRepository.findOneBy({ userUuid: id });
        return user;
      }),
    );

    return users.filter((user) => user !== null);
  }

  // 회원 탈퇴
  async deleteUser(userUuid: string) {
    const user = await this.userRepository.findOneBy({ userUuid });

    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 사용자를 찾을 수 없습니다.',
      );
    }

    user.status = UserStatusType.DELETE;
    user.nickname = null;
    user.profileImage = null;
    user.socialId = null;
    user.socialNickname = null;
    user.profileImage = null;
    user.pushToken = null;
    user.introduction = null;

    await this.userRepository.save(user);

    return { message: '회원 탈퇴 성공!' };
  }

  /**
   * 사용자 정보 조회
   * @param userUuid 사용자 UUID
   * @returns 사용자 정보 (닉네임, 프로필 이미지, 소개글, UUID)
   */
  async getUserInfo(userUuid: string) {
    const user = await this.userRepository.findOne({
      where: { userUuid },
    });

    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 사용자를 찾을 수 없습니다.',
      );
    }

    // 2. 해당 사용자가 작성한 게시글 개수 조회
    const postCount = await this.postRepository.count({
      where: { userUuid },
    });

    // 친구 수 조회 (내가 요청자이거나 받는자로 ACCEPTED 된 친구관계 수)
    const friendCount = await this.friendshipRepository.count({
      where: [
        { requesterUuid: userUuid, status: FriendshipStatus.ACCEPTED },
        { addresseeUuid: userUuid, status: FriendshipStatus.ACCEPTED },
      ],
    });

    const age = this.calculateAge(user.birthDate);

    return {
      userName: user.nickname,
      userImage: user.profileImage,
      userIntroduction: user.introduction,
      userUuid: user.userUuid,
      userAge: age,
      coins: user.coins,
      postCount,
      friendCount,
    };
  }

  /**
   * 다른 사용자 정보 조회
   * @param userUuid 조회할 사용자 UUID
   * @returns 사용자 정보 (닉네임, 프로필 이미지, 소개글, UUID, 게시글 수, 친구 수)
   */
  async getOtherUserInfo(viewerUuid: string, userUuid: string) {
    const user = await this.userRepository.findOne({
      where: { userUuid },
    });

    if (!user) {
      CustomException.throw(
        ErrorCode.USER_NOT_FOUND,
        '해당 사용자를 찾을 수 없습니다.',
      );
    }

    // 게시글 수 조회
    const postCount = await this.postRepository.count({
      where: { userUuid },
    });

    // 친구 수 조회
    const friendCount = await this.friendshipRepository.count({
      where: [
        { requesterUuid: userUuid, status: FriendshipStatus.ACCEPTED },
        { addresseeUuid: userUuid, status: FriendshipStatus.ACCEPTED },
      ],
    });
    // 친구 상태 조회 (viewerUuid <-> userUuid 관계)
    const friendRelation = await this.friendshipRepository.findOne({
      where: [
        { requesterUuid: viewerUuid, addresseeUuid: userUuid },
        { requesterUuid: userUuid, addresseeUuid: viewerUuid },
      ],
    });

    let friendStatus: string;
    let friendId: number | null = null;

    if (!friendRelation) {
      friendStatus = 'no_relation';
    } else {
      friendId = friendRelation.id;

      if (friendRelation.status === FriendshipStatus.PENDING) {
        friendStatus =
          friendRelation.requesterUuid === viewerUuid
            ? 'request_sent'
            : 'request_received';
      } else if (friendRelation.status === FriendshipStatus.ACCEPTED) {
        friendStatus = 'friends';
      } else if (friendRelation.status === FriendshipStatus.BLOCKED) {
        friendStatus = 'blocked';
      }
    }

    const age = this.calculateAge(user.birthDate);

    return {
      userName: user.nickname,
      userImage: user.profileImage,
      userIntroduction: user.introduction,
      userUuid: user.userUuid,
      userAge: age,
      postCount,
      friendCount,
      friendStatus,
      friendId,
    };
  }
}
