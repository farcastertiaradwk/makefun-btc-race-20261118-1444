// Dip-reversion BTC bot for make.fun btc-race-24h-20261118-1444.
//
// Strategy: "Three-Dip Reversion". The bot trades Coinbase Wrapped BTC (CBBTC)
// against USDC on 1-minute bars, long only, at most one open position, at most
// three round trips in the 24-hour window.
//
// Idea: on a choppy or drifting day the money is in buying a clear dip and
// selling the snap-back quickly, never in holding through the drift. The bot
// arms when the close falls a set distance below the trailing 6-hour high,
// waits for a confirmed bounce off the setup low (a close back above the low
// plus a rising bar), then buys full size at the next open. It exits on a
// modest profit target, a trailing stop once the trade is in profit, a hard
// stop, or a time stop if the bounce stalls. A 60-bar cooldown after every
// exit keeps it from re-entering the same downdraft. A second, deeper tier
// arms on a washout (-3.50%) with a stronger confirmation, for days that fall
// much further.
//
// Dev-window result: to be recorded after grade-local (see commit history).
// All comparisons are integer basis-point math on the raw close values, so the
// two graded runs are byte-identical. No clock, no environment, no randomness.

import { runBars } from './vendor/makefun-bars.ts';
import type { BarsState, Batch, OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const BPS = 10_000n;

// --- parameters (basis points unless noted) ---
const TRAIL_HIGH_BARS = 360; // trailing window for the reference high (6h)
const ARM_SHALLOW_BPS = 140n; // arm a setup 1.40% below the trailing high
const ARM_DEEP_BPS = 350n; // washout tier: 3.50% below the trailing high
const CONFIRM_SHALLOW_BPS = 12n; // bounce 0.12% above the setup low to confirm
const CONFIRM_DEEP_BPS = 25n; // washout tier needs a 0.25% bounce
const CANCEL_BPS = 50n; // cancel the setup if the dip recovers past -0.50%
const ROOM_SHALLOW_BPS = 120n; // need 1.20% of room back to the high
const ROOM_DEEP_BPS = 260n; // washout tier needs 2.60% of room
const TARGET_BPS = 80n; // take profit 0.80% above the entry close
const TRAIL_BPS = 60n; // trailing stop 0.60% under the peak
const TRAIL_ARM_BPS = 30n; // trailing stop arms once 0.30% in profit
const STOP_BPS = 60n; // hard stop 0.60% below the entry close
const TIME_STOP_BARS = 480; // exit a stalled trade after 480 bars
const TIME_STOP_MIN_BPS = 20n; // ... if it is under entry + 0.20%
const COOLDOWN_BARS = 60; // wait 60 bars after an exit before re-arming
const MAX_TRADES = 3; // at most three round trips per window
const NO_TRADE_AFTER = 1350; // no new entries in the last 90 bars
const MAX_SLIPPAGE_BPS = 200; // fills move ~7 bps a minute; 200 is ample
const MIN_NOTIONAL = 1_000_000n; // 1 USDC, in quote units

type Tier = 'shallow' | 'deep';

interface Setup {
  tier: Tier;
  low: bigint;
  high: bigint;
}

class DipReversionBot {
  private closes: bigint[] = [];
  private setup: Setup | null = null;
  private entryClose: bigint | null = null;
  private entryBar = -1;
  private peak = 0n;
  private trades = 0;
  private cooldownUntil = -1;
  private pendingBuy = false;
  private pendingSell = false;

  onBatch(state: BarsState, _batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const seq = state.seq;
    const scored = seq - state.warmupBars;
    this.closes.push(close);
    const held = state.positions.get(SYMBOL);
    const qty = held === undefined ? 0n : held.qty;

    // Settle orders sent on the previous batch.
    if (this.pendingBuy) {
      this.pendingBuy = false;
      if (qty <= 0n) {
        // Buy rejected: drop the stale entry, brief pause, no re-entry now.
        this.entryClose = null;
        this.cooldownUntil = seq + 10;
        return [];
      }
    }
    if (this.pendingSell) {
      this.pendingSell = false;
      if (qty <= 0n) {
        this.trades += 1;
        this.cooldownUntil = seq + COOLDOWN_BARS;
        this.setup = null;
        this.entryClose = null;
        return [];
      }
    }

    // --- exits ---
    if (qty > 0n && this.entryClose !== null) {
      if (close > this.peak) this.peak = close;
      const entry = this.entryClose;
      const targetHit = close * BPS >= entry * (BPS + TARGET_BPS);
      const trailArmed = this.peak * BPS >= entry * (BPS + TRAIL_ARM_BPS);
      const trailHit = trailArmed && close * BPS <= this.peak * (BPS - TRAIL_BPS);
      const stopHit = close * BPS <= entry * (BPS - STOP_BPS);
      const heldBars = seq - this.entryBar;
      const timeHit = heldBars >= TIME_STOP_BARS && close * BPS < entry * (BPS + TIME_STOP_MIN_BPS);
      if (targetHit || trailHit || stopHit || timeHit) {
        this.pendingSell = true;
        return [{ side: 'sell', symbol: SYMBOL, qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }

    // --- entries ---
    if (qty === 0n && !this.pendingBuy) {
      if (this.trades < MAX_TRADES && seq >= this.cooldownUntil && scored < NO_TRADE_AFTER) {
        const window = this.closes.slice(-TRAIL_HIGH_BARS);
        let high = window[0]!;
        for (const c of window) if (c > high) high = c;
        const dipBps = ((close - high) * BPS) / high;
        if (this.setup === null) {
          if (dipBps <= -ARM_DEEP_BPS) this.setup = { tier: 'deep', low: close, high };
          else if (dipBps <= -ARM_SHALLOW_BPS) this.setup = { tier: 'shallow', low: close, high };
        } else {
          if (close < this.setup.low) this.setup.low = close;
          // Upgrade a shallow setup if the fall deepens into a washout.
          if (this.setup.tier === 'shallow' && dipBps <= -ARM_DEEP_BPS) this.setup.tier = 'deep';
          // Cancel if the dip mostly recovered without confirming.
          if (close * BPS > this.setup.high * (BPS - CANCEL_BPS)) {
            this.setup = null;
          } else {
            const tier = this.setup.tier;
            const confirm = tier === 'deep' ? CONFIRM_DEEP_BPS : CONFIRM_SHALLOW_BPS;
            const roomNeed = tier === 'deep' ? ROOM_DEEP_BPS : ROOM_SHALLOW_BPS;
            const rising = this.closes.length >= 2 && close > this.closes[this.closes.length - 2]!;
            const confirmed = close * BPS >= this.setup.low * (BPS + confirm) && rising;
            const roomOk = high * BPS >= close * (BPS + roomNeed);
            if (confirmed && roomOk) {
              const room = state.weightRoom(SYMBOL);
              const notional = state.cash < room ? state.cash : room;
              if (notional >= MIN_NOTIONAL) {
                this.entryClose = close;
                this.entryBar = seq;
                this.peak = close;
                this.setup = null;
                this.pendingBuy = true;
                return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
              }
            }
          }
        }
      }
    }
    return [];
  }
}

const bot = new DipReversionBot();
await runBars({ onBatch: (state, batch) => bot.onBatch(state, batch) });
