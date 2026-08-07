---
description: Connect a broker or market-data source (guided)
argument-hint: [source name, optional]
---

Guide me through connecting a broker or market-data source. Ask the questions in chat, one at a time, offering the choices as a short list I can pick from. Do not build any custom UI or form. Base every option on what `list_sources` actually returns, and never invent a source.

First call `list_sources` to see what's available and what's already connected. Then walk me through three short questions:

1. **What do you need?**
   - Trading and market data (place live orders and pull quotes) - needs a broker
   - Market data only (quotes and historical bars, no live orders)

2. **Which account?** (fit this to my first answer)
   - If trading and market data: Paper (simulated) or Live (real money)
   - If market data only: Paper broker, Live broker, or Third-party data vendor

3. **Which source(s)?** (let me pick more than one; build the list from `list_sources`)
   - If I chose a broker: only offer brokers that actually stream data - the `market_data_brokers` in the `list_sources` result (today that is Interactive Brokers and Alpaca). If I ask to trade on an execution-only broker, say plainly that it can place orders but not stream quotes, and offer to pair it with a data vendor.
   - If I chose a data vendor: offer the `catalog`, grouped by cost - Free (no account), Free (needs a free account and key), and Paid. Show the cost next to each.

Then connect each choice with `connect_source { id }`:
- Free and keyless (e.g. yfinance): connects right away.
- Needs a key: `connect_source` opens a masked paste field in the panel. Tell me to paste the key there. Never ask me to type a key into chat, and never put a key in a tool call.
- Interactive Brokers: `connect_source` starts it, then walk me through the IB Gateway login (it uses the gateway sign-in, not an API key).

When you're done, call `connection_status` to confirm, and tell me plainly what's now connected and what it can do (trade, market data, or both). If I haven't connected a real data source, remind me that yfinance is a free floor for backtests.

If I already named a source in $ARGUMENTS (for example `/brokerdata alpaca`), skip the questions and connect that one directly, still using the masked field for any key.
