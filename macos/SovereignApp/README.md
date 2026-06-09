# Sovereign App for macOS

Minimal macOS shell for the Meanly One / Simple-L1 identity home.

The app opens a native macOS window, starts the local `node/server.js` identity runtime when needed, and loads:

```text
http://localhost:3000/identity
```

This keeps the current protocol implementation shared with the web reference UI while making the user entry point feel like a standalone sovereign app.

## Run

```bash
./macos/SovereignApp/run.sh
```

The built app is written to:

```text
macos/SovereignApp/build/Meanly One.app
```

## Boundary

- The macOS app is the product shell.
- `node/server.js` remains the local identity runtime.
- `My Identity`, `Trusted Devices`, `Add phone`, `Sync`, and `Continue with Meanly` remain the user-facing flow.
- `sl1e_*`, controller bindings, mesh envelopes, and identity proof internals stay behind developer details.

If the app is moved outside this checkout, launch it with `SIMPLE_L1_ROOT` pointing at the repository root so it can find `node/server.js`.
