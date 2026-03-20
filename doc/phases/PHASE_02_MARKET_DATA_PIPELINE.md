# Phase 02: Market Data Pipeline

## 1. 目标

建立最小市场数据摄取层，打通交易所数据到领域模型的标准化流程。

## 2. 前置依赖

- `PHASE_01_PROJECT_BOOTSTRAP`

## 3. 允许修改范围

- `src/clients/exchange/*`
- `src/domain/market/*`
- `src/services/market-data/*`
- `src/utils/*`
- `test/unit/*`
- `test/integration/*`
- `src/app/config.ts`

## 4. 交付物

- `Candle`
- `FundingRatePoint`
- `OpenInterestPoint`
- 交易所客户端接口与基础实现（含 `fetchSpotTicker`）
- 市场数据抓取服务

## 5. 任务清单

1. 定义 `Candle`、`FundingRatePoint`、`OpenInterestPoint`。
2. 定义 `ExchangeClient` 接口，必须包含 `fetchSpotTicker()` 方法。
3. 实现 `ccxt-client.ts` 的最小可用版本。
4. 实现 `fetchMarketData()`。
5. 实现 `fetchFundingRates()`。
6. 实现 `fetchOpenInterest()`。
7. 实现 `fetchSpotTicker()`：
   - 若交易所支持独立现货 ticker，直接调用现货交易对
   - 若不支持，使用同交易所现货交易对的 `fetchTicker` 替代
   - 若现货数据暂时不可用，默认返回 `{ last: 0 }`
8. 统一时间戳、数字精度和空值处理。
9. 为标准化逻辑写集成测试或 fixture 测试（含现货 ticker）。

## 6. 禁止事项

- 不实现市场状态判断
- 不实现参与者压力结论
- 不实现结构层
- 不实现共识层
- 不接 LLM

## 7. 验收标准

- 能返回标准化 OHLCV 数据。
- 能返回标准化 funding 数据。
- 能返回标准化 OI 数据。
- 能返回现货 ticker（或在不可用时返回默认值）。
- 接口异常有清晰失败行为。
- 数据类型与主文档一致。
