# Phase 01: Project Bootstrap

## 1. 目标

建立 Stratum 的最小 TypeScript 工程骨架，使后续阶段可以在稳定目录结构、配置系统和测试环境上继续开发。

## 2. 前置依赖

无。

## 3. 允许修改范围

- `package.json`
- `tsconfig.json`
- `src/app/*`
- `src/index.ts`
- `test/*`
- 基础配置文件，如 lint 或格式化配置

## 4. 交付物

- TypeScript 项目初始化完成
- 测试框架可运行
- 环境变量读取模块
- 配置集中管理模块
- 基础日志模块
- 初始目录结构

## 5. 任务清单

1. 初始化 Node.js + TypeScript 项目。
2. 建立 `src/`、`test/` 基础目录。
3. 配置测试框架，优先 `vitest`。
4. 建立 `src/app/env.ts`，负责环境变量校验。
5. 建立 `src/app/config.ts`，负责静态配置与策略配置。
6. 建立 `src/app/logger.ts`，提供基础结构化日志能力。
7. 建立 `src/index.ts` 作为后续入口占位。
8. 确保 `npm test` 或 `pnpm test` 可执行。

## 6. 禁止事项

- 不接交易所 API
- 不实现市场状态逻辑
- 不实现参与者压力逻辑
- 不实现结构扫描
- 不接数据库
- 不接 Telegram

## 7. 验收标准

- 项目可以安装依赖并运行测试命令。
- 环境变量缺失时会给出清晰错误。
- 配置项不散落在多个业务文件中。
- 日志模块可被后续服务复用。
- 目录结构与主文档保持一致。
