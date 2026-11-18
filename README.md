# makefun-btc-race-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/farcastertiaradwk/makefun-btc-race-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/farcastertiaradwk/makefun-btc-race-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

"Three-Dip Reversion" — a dip-buying BTC trading bot for make.fun's "Race a BTC trading bot live for 24 hours" bounty. It trades Coinbase Wrapped BTC (CBBTC) against USDC on 1-minute bars: it arms when the close falls 1.40% below the trailing 6-hour high, waits for a confirmed bounce off the setup low, buys full size, and exits fast on a +0.80% target, a trailing stop, a hard stop, or a time stop. At most three round trips per window, with a 60-bar cooldown after every exit. A deeper tier arms on a −3.50% washout with a stronger confirmation.

## Run it

```sh
node <kit>/cli/makefun.mjs grade-local --kit <kit> --bot . --driver process
```

The entrypoint is `main.ts` (Node 22, erasable TypeScript; the kit's bars shim is vendored byte-for-byte under `vendor/`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
