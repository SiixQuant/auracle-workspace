---
description: Connect, turn off, or check a broker or data source
argument-hint: [source name, optional]
---

Help me manage my broker and market-data connections. Ask which I want (a short list I can pick from), then do it. Base every option on what `list_sources` actually returns — never invent a source.

First call `list_sources` to see what's available and what's already connected. Then offer:

1. **Connect something** — turn a broker or data source ON. Walk me through it:
   - **What do you need?** Trading and market data (place live orders and pull quotes — needs a broker), or market data only (quotes and historical bars, no live orders).
   - **Which account?** Paper (simulated) or Live (real money) for a broker; or a third-party data vendor.
   - **Which source(s)?** (let me pick more than one, built from `list_sources`) — if a broker, offer only brokers that actually stream data (the `market_data_brokers` in the result; today Interactive Brokers and Alpaca). If I pick an execution-only broker (e.g. **Clear Street**, Tradier, Tradovate), say plainly it can place orders but not stream quotes, and offer to pair it with a data vendor. If a vendor, offer the `catalog` grouped by cost — Free, Free with an account, and Paid.
   - Then connect each with `connect_source { id }`: free/keyless connects immediately; a keyed source opens a masked paste field in the panel (tell me to paste the key there — never ask me to type a key into chat, and never put a key in a tool call); Interactive Brokers walks through its gateway sign-in.

2. **Turn something off** — call `connection_status` to show what's on, ask which to disconnect, then call `disconnect_source { id }`. The free yfinance data floor stays available regardless.

3. **Check what's connected** — call `connection_status` and report plainly what's on and what each can do (trade, market data, or both).

4. **Download historical price data** — ask me for a symbol, exchange, and date range, then download and store the daily bars and confirm how many were inserted.

Honesty rules: only offer what `list_sources` returns; never claim a broker streams data unless it's in `market_data_brokers`; a key never travels through a tool call or chat — only the masked field. If I named a source in $ARGUMENTS (e.g. `/connect clearstreet`), skip the questions and go straight to connecting it, still using the masked field for any key.
