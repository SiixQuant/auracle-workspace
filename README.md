# Auracle is the IDE for algorithmic trading

Auracle is a desktop workbench where you research, build, backtest, validate, and deploy trading strategies in one place, with an AI agent working alongside you the whole way. You write strategies in Python, and Auracle handles the parts around them: pulling market data, running backtests, checking a strategy for overfitting, and routing live orders to your real broker accounts through a local engine you run yourself.

Every edge is built here. Auracle sells the infrastructure for building trading systems, not the systems themselves. What you build, and whether it makes money, is yours.

> **A note on the name.** Auracle began as a self-hosted trading engine, a way to backtest and schedule strategies on your own hardware. That engine is still the core, but the product has grown up around it. The front door today is this IDE: an AI-native desktop app that turns "I have an idea" into a validated, deployable strategy without leaving the editor. The older "self-hosted platform" framing you may see in places predates that shift.

![Version](https://img.shields.io/badge/version-1.1.x-60a5fa)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

## How the pieces fit together

Auracle is three programs that work as one system:

| Piece | What it is | What you do with it |
| --- | --- | --- |
| **Auracle IDE** (this repo) | The desktop app. An editor, an AI agent, and a set of purpose-built trading panels. | Build strategies. This is where you spend your time. |
| **Auracle engine** ("Houston") | A local FastAPI service, run as a Docker stack on your own machine. | The brain. It holds your market data, runs backtests, talks to your brokers, and executes live deployments. Your strategies and broker keys never leave your hardware. |
| **Auracle launcher** | A small native app that manages the engine's Docker stack. | Install and update the engine, watch its health, read logs, all without touching a terminal. |

The IDE talks to the engine over a local API. The engine talks to your brokers (Interactive Brokers, Alpaca, and others). Nothing about your strategies is hosted by us.

## What you can do in the IDE

The IDE is built on an open, extensible editor. On top of it, Auracle ships a set of trading-specific surfaces:

- **Research.** A curated feed of finance and science findings, with a one-action "Transmog" that hands a finding to the AI agent as a full strategy-development brief.
- **Run a backtest from the editor.** Open any strategy file and press Run. You get an equity curve, headline stats (return, Sharpe, drawdown), a drawdown chart, and a one-click overfit check, right next to your code.
- **QuantConnect.** Import your QuantConnect projects, run cloud backtests, and read their results (equity curve and statistics) inside Auracle, or export an Auracle strategy out to QuantConnect.
- **Validation.** Put a candidate strategy through out-of-sample and robustness checks before you trust it with money.
- **Live Algorithms.** A deploy wizard walks you from a tagged strategy to a running live (or paper) deployment: pick the broker, set the starting capital, choose where it runs, and go. A dashboard then tracks each deployment's status, return, and equity over time.
- **Monitors.** The order blotter, incident log, schedules, and the research-to-live runway, so you can see what the engine is doing at a glance.
- **Strategy Flow.** A visual node canvas for sketching a strategy's structure.
- **Connections.** One place to connect your brokers and data sources; the credentials are stored by the engine, not the app.
- **The Auracle Agent.** An AI coding agent that knows the engine's tools. It can scan research, draft a strategy, run a backtest, walk it forward, and prep a pre-market check, all through plain-English commands.

Free to research, build, and backtest. Live trading is a paid unlock, and teams have an enterprise tier. Sign-in is handled through your Auracle account.

## Getting started

The easiest path is the **Auracle launcher**, which installs the engine and keeps the IDE up to date for you. See [auracle-desktop](https://github.com/SiixQuant/auracle-desktop).

To install the IDE on its own, download the latest build for your platform from the [releases page](https://github.com/SiixQuant/auracle-ide/releases/latest). macOS builds are currently unsigned, so on first launch right-click the app and choose **Open** to get past Gatekeeper.

Once it is running:

1. **Connect the engine.** The IDE looks for your local Auracle engine. If you used the launcher, it is already there.
2. **Open or create a strategy** in Python.
3. **Ask the agent** to research an idea, draft a strategy, or explain the code.
4. **Run a backtest** from the editor and read the equity curve and overfit check.
5. **Validate**, then **deploy** to paper or live from the Live Algorithms wizard.

## Auto-updates

Auracle checks for updates and offers them when a new version is available; the launcher delivers IDE updates for you. Installs default to the **stable** channel. Early-access builds are on the **alpha** channel, which is rougher and may break; you can switch back to stable at any time.

## Telemetry

Auracle sends **anonymous usage analytics** so we can see how the app is used and prioritize improvements. We never collect usernames, emails, or IP addresses; file contents or paths; API keys or tokens; or your document, session, strategy, or chat content. A random anonymous ID correlates events from the same install, and you can opt out under **Settings**.

For the complete list of events, see [POSTHOG_EVENTS.md](./docs/POSTHOG_EVENTS.md); for the rules the analytics code follows, see [ANALYTICS_GUIDE.md](./docs/ANALYTICS_GUIDE.md).

## Building from source

Auracle IDE is a TypeScript / Electron monorepo using npm workspaces.

```bash
# Install dependencies (npm 7+ required)
npm install

# Start the app in dev mode
cd packages/electron && npm run dev

# Build a local Mac binary
cd packages/electron && npm run build:mac:local
```

Major workspaces:

- `packages/electron`: the desktop application (Electron)
- `packages/runtime`: cross-platform runtime services (AI, sync, editors)
- `packages/extension-sdk`: the extension development kit
- `packages/extensions`: built-in extensions, including **`auracle-pack`**, which contains all of the trading panels described above
- `packages/ios`: the native iOS companion app (SwiftUI)

The trading surfaces live in [`packages/extensions/auracle-pack`](./packages/extensions/auracle-pack). They talk to the engine through the app's IPC layer and render with the shared panel design system. For architecture and contributor guidance, see [CLAUDE.md](./CLAUDE.md) and the docs under [`docs/`](./docs).

## Built on Nimbalyst

The IDE is a fork of [Nimbalyst](https://nimbalyst.com), an open-source visual workspace for AI coding agents. Auracle keeps Nimbalyst's editor, agent, and extension system, and adds the trading-specific engine integration, panels, and design language on top. This repository is licensed under the **MIT License**; see [LICENSE](./LICENSE). For licensing context, see [LICENSING.md](./LICENSING.md).

## Learn more

- **Website:** [auracle-engine.com](https://auracle-engine.com)
- **The engine:** [SiixQuant/Auracle](https://github.com/SiixQuant/Auracle)
- **The launcher:** [SiixQuant/auracle-desktop](https://github.com/SiixQuant/auracle-desktop)
