# Yuna Desktop release checklist

Start each day by running `npm run typecheck`, `npm test`, and `npm run build:ui && npm run check:bundle` from the repository root. The **Desktop build** workflow runs on pull requests and pushes to release branches. Once it is on the default branch, it can also be started manually from GitHub Actions. Treat its artifacts as installer candidates until they pass clean-install testing.

## Day 1 · Produce Windows and macOS build candidates

- [ ] Run the desktop build workflow. It generates icons, builds Tauri, and uploads the Windows MSI and EXE and the macOS DMG.
- [ ] Record any build errors by platform and rerun the affected job after fixing them.

## Day 2 · Make the installed app self-contained

- [x] Stage the agent, locked production dependencies, and Node for inclusion in the installer. The build checks the staged agent against a temporary database before building installers.
- [ ] Install each candidate on a machine without a Yuna checkout. Launch the app and verify that Quick Chat connects to the local agent. Verify a model response through a configured OpenCode backend.
- [ ] Verify that user preferences remain available after closing and relaunching the installed app.

## Day 3 · Exercise Mochi on both operating systems

- [ ] Enable Desktop Pet in Settings. Rename it, try all three sizes, and verify that the name, size, and position survive a relaunch.
- [ ] Drag the pet, click it to open Quick Chat, click through transparent pixels, and toggle the pet from the tray.
- [ ] Test the existing global shortcut and keyboard access. Check that dragging across displays works at different scaling settings and that disconnecting a display leaves the pet reachable.
- [ ] Close Quick Chat during a task. Verify working, confirmation, ready, and error states, then open the saved reply. Check the preview with reduced motion enabled.

## Day 4 · Prepare the release

- [ ] Sign the Windows installer and sign and notarize the macOS build for distribution.
- [ ] Repeat clean-install and upgrade checks with the signed artifacts. Verify chat history and pet settings survive the upgrade.
- [ ] Publish only after the intended platform builds and installation checks pass.
