import { JwtAuthGuard } from '@/auth/guards/jwt-auth.guard';
import { UserUuid } from '@/decorators/user-uuid.decorator';
import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  UseGuards,
  Param,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiGetUserInfo,
  ApiUpdateProfile,
  ApiLogout,
  ApiOnboarding,
  ApiGetOtherUserInfo,
  ApiDeleteUser,
} from './decorators/users.swagger';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { OnBoardingDto } from './dto/onBoarding.dto';

@ApiTags('user')
@ApiBearerAuth('JWT-auth')
@Controller('user')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('onboarding')
  @ApiOnboarding()
  async completeOnboarding(
    @Body() onBoardingDto: OnBoardingDto,
    @UserUuid() UserUuid: string,
  ) {
    return this.usersService.completeOnboarding(UserUuid, onBoardingDto);
  }

  @Post('logout')
  @ApiLogout()
  async logout(@UserUuid() UserUuid: string) {
    return this.usersService.logout(UserUuid);
  }

  @Post('profile')
  @ApiUpdateProfile()
  @UseGuards(JwtAuthGuard)
  async updateProfile(
    @Body() updateProfileDto: UpdateProfileDto,
    @UserUuid() UserUuid: string,
  ) {
    return this.usersService.updateProfile(UserUuid, updateProfileDto);
  }

  @ApiDeleteUser()
  @Delete('member')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@UserUuid() UserUuid: string) {
    return this.usersService.deleteUser(UserUuid);
  }

  @Get('userInfo')
  @ApiGetUserInfo()
  async getUserInfo(@UserUuid() UserUuid: string) {
    return this.usersService.getUserInfo(UserUuid);
  }

  /**
   * 다른 사용자 정보 조회
   * @param userUuid 조회할 사용자 UUID
   * @param viewerUuid 현재 로그인한 사용자 UUID
   * @returns 사용자 정보 (닉네임, 프로필 이미지, 소개글, UUID, 게시글 수, 친구 수, 친구 상태)
   */
  @Get('info/:userUuid')
  @ApiGetOtherUserInfo()
  async getOtherUserInfo(
    @Param('userUuid') userUuid: string,
    @UserUuid() viewerUuid: string, // 현재 로그인한 사용자 UUID 데코레이터
  ) {
    return this.usersService.getOtherUserInfo(viewerUuid, userUuid);
  }
}
