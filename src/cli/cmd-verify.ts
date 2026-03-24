import { CcxtClient } from "../clients/exchange/ccxt-client.js";
import { env } from "../app/env.js";
import { logger } from "../app/logger.js";
import { bold, cyan, green, yellow, red, dim } from "./fmt.js";

/**
 * API 链路与实盘配置校验 (TASK-P3-C Dry-run)
 */
export async function cmdVerify(): Promise<void> {
  console.log();
  console.log(bold(cyan("  Stratum v0.13 API 链路物理校验 (TASK-P3-C)")));
  console.log(dim("  --------------------------------------------------"));

  console.log(`  1. 运行模式:  ${env.EXECUTION_MODE === "live" ? bold(red("LIVE (实盘接驳)")) : bold(green("PAPER (模拟计费)"))}`);
  console.log(`  2. 交易所:    ${bold(env.EXCHANGE_NAME)}`);
  console.log(`  3. 交易品种:  ${bold(env.SYMBOL)}`);
  
  if (env.EXECUTION_MODE === "live") {
    if (!env.EXCHANGE_API_KEY || !env.EXCHANGE_SECRET) {
      console.log(red("  ✗ 错误: 实盘模式已开启，但缺少 API_KEY 或 SECRET。"));
      return;
    }
    console.log(green("  ✓ API 密钥已加载"));
  }

  const client = new CcxtClient(env.EXCHANGE_NAME, env.SPOT_SYMBOL);

  try {
    console.log(dim("  正在测试 API 通讯..."));
    
    // 测试 公有接口
    const ticker = await client.fetchTicker(env.SYMBOL);
    console.log(green(`  ✓ 公有接口正常: ${env.SYMBOL} 当前价 ${ticker.last}`));

    // 测试 私有接口
    if (env.EXCHANGE_API_KEY) {
      const balance = await client.fetchBalance();
      console.log(green(`  ✓ 私有接口正常: 账户总权益 $${balance.totalEquity.toFixed(2)}`));
      console.log(green(`  ✓ 可用保证金:   $${balance.availableMargin.toFixed(2)}`));
    } else {
      console.log(yellow("  ! 警告: 未检测到 API 密钥，跳过私有接口测试"));
    }

    console.log();
    console.log(bold(green("  [PASS] 物理链路校验成功。系统已具备阶段 P3-C 的执行条件。")));

  } catch (err: any) {
    console.log(red(`  ✗ 校验失败: ${err.message}`));
    console.log(dim("    请检查网络环境、代理设置或 API 密钥权限、权限是否包含 IP 白名单。"));
  }
  console.log();
}
