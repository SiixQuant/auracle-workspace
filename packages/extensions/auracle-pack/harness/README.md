# Panel render harness

A local, dev-only way to see an `auracle-pack` panel in a browser without
running the full IDE host. It mounts the real panel component with the engine
bridge (`window.electronAPI.invoke`) stubbed to mock JSON and the IDE theme
variables applied, so panel changes can be screenshot-verified in isolation.

Not part of the built extension — the Vite build entry is `src/index.tsx`, and
the package `tsconfig` only includes `src/`, so nothing here ships.

## Run

```sh
# from packages/extensions/auracle-pack
npx vite --config harness/vite.config.ts
# then open http://127.0.0.1:5199/?panel=live  (or ?panel=validation)
```

## Add a panel

Edit `main.tsx`: import the panel, add a `?panel=` branch, and extend
`engineRequest()` with any endpoints it polls (return `ok(mockBody)`).
