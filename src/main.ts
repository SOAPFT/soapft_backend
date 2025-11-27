import * as dotenv from 'dotenv';
import * as path from 'path';

// 환경변수 파일이 존재할 때만 로드
const envPath = path.join(
  __dirname,
  '..',
  'env',
  `.${process.env.NODE_ENV || 'development'}.env`,
);
try {
  dotenv.config({ path: envPath });
} catch {
  console.log(`환경변수 파일을 찾을 수 없습니다: ${envPath}`);
  console.log('시스템 환경변수를 사용합니다.');
}

import * as crypto from 'crypto';
try {
  if (typeof global !== 'undefined' && !global.crypto) {
    Object.defineProperty(global, 'crypto', {
      value: crypto,
      writable: false,
      configurable: true,
    });
  }
} catch {}

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { GlobalExceptionFilter } from './utils/global-exception.filter';

declare const module: any;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['error', 'warn', 'log']
        : ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  const configService = app.get(ConfigService);
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const config = new DocumentBuilder()
    .setTitle('SOAPFT API')
    .setDescription('SOAPFT API documentation')
    .setVersion(process.env.npm_package_version || '0.0.1')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      filter: true,
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
      displayRequestDuration: true,
      deepLinking: true,
    },
  });

  const port = configService.get<number>('PORT') ?? 7777;
  await app.listen(port);
  console.log(`💧SOAPFT ${port}번 포트에서 실행중입니다.`);
  console.log(`📖 REST API 문서: http://localhost:${port}/api/docs`);
  console.log(
    `📡 WebSocket API 문서: https://studio.asyncapi.com (backend/asyncapi.yaml)`,
  );

  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}
bootstrap();
