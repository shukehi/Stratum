import WebSocket from "ws";
import { logger } from "../../app/logger.js";

export type WsOiPayload = {
  symbol: string;
  timestamp: number;
  openInterest: number;
};

export class BinanceWsClient {
  private ws: WebSocket | null = null;
  private symbol: string;
  private onOiEvent?: (payload: WsOiPayload) => void;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private abortSignal?: AbortSignal;

  constructor(symbol: string) {
    this.symbol = symbol.replace("/", "").replace(":USDT", "").toLowerCase(); // "BTCUSDT" -> "btcusdt"
  }

  public subscribeOi(callback: (payload: WsOiPayload) => void, signal?: AbortSignal) {
    this.onOiEvent = callback;
    this.abortSignal = signal;
    this.connect();

    if (signal) {
      signal.addEventListener("abort", () => {
        this.disconnect();
      }, { once: true });
    }
  }

  private connect() {
    if (this.ws) return;

    const url = `wss://fstream.binance.com/ws/${this.symbol}@openInterest`;
    logger.info({ url }, "WebSocket: Connecting to Binance OI stream");

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      logger.info("WebSocket: Connected to OI stream");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.ws.on("message", (data: WebSocket.RawData) => {
      try {
        const payload = JSON.parse(data.toString());
        if (payload.e === "openInterest" && this.onOiEvent) {
          this.onOiEvent({
            symbol: payload.s,
            timestamp: payload.E,
            openInterest: parseFloat(payload.o)
          });
        }
      } catch (err) {
        logger.error({ err, data: data.toString() }, "WebSocket: failed to parse message");
      }
    });

    this.ws.on("error", (err) => {
      logger.error({ err }, "WebSocket: error occurred");
    });

    this.ws.on("close", () => {
      this.ws = null;
      if (!this.abortSignal?.aborted) {
        logger.warn("WebSocket: connection closed, reconnecting in 5s");
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });
  }

  private disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      logger.info("WebSocket: connection intentionally closed");
    }
  }
}
