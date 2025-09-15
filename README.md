# QuantumTimeTravel

[![Deploy static site to GitHub Pages](https://github.com/Idyll-Intelligent-Systems/QuantumTimeTravel/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Idyll-Intelligent-Systems/QuantumTimeTravel/actions/workflows/deploy-pages.yml)

[![Deploy static site to GitHub Pages](https://github.com/Idyll-Intelligent-Systems/QuantumTimeTravel/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Idyll-Intelligent-Systems/QuantumTimeTravel/actions/workflows/deploy-pages.yml)

Time travel software engine, wanna include quantum hardware, bio-tech, and test subjects and actually travel? Feel free to reach out—let's leave our past and go beyond Time!

## Live site (GitHub Pages)

- [https://idyll-intelligent-systems.github.io/QuantumTimeTravel/](https://idyll-intelligent-systems.github.io/QuantumTimeTravel/)

Notes:

- The web UI is static and can call the API. When hosted on GitHub Pages, set the API base via the header “API” field or add `?api=https://your-host/api` to the URL.
- The Pages workflow builds the UI from the `web/` directory and publishes the generated static files from `web/dist/`.

### Enable Pages + verify

1) Settings → Pages → Source: select “GitHub Actions”, Save.
2) Trigger a deployment: push to `main`, or Actions → "Deploy static site to GitHub Pages" → Run workflow.
3) Verify: open the latest workflow run; both jobs (build, deploy) should pass. The deployment exposes the URL under the `github-pages` environment.
4) First load: open the live site and set the API base in the header (e.g., `https://your-domain/api`).

## X Social Accounts

- [https://x.com/shivaveld_idyll](https://x.com/shivaveld_idyll)
- [https://x.com/exezexy9](https://x.com/exezexy9)
- [https://x.com/vesolutions03](https://x.com/vesolutions03)
- [https://x.com/VSK2k07_InTenSE](https://x.com/VSK2k07_InTenSE)
- [https://x.com/VSK2k0725](https://x.com/VSK2k0725)

## Content

Grasping time is possible in 4D Quantum Mechanics mostly, I have created FSMs for time travel using DAG and Quantum DSA, involves qbits, tflops, Quantum-core-i1 processor or in general quantum compution processor (0to1 continuos range) than traditional 1x0bits ans traditional CPU or GPU. Able to take out Negative loops and compute the the round trip from A to B to C to A. A(FSM Past), B(FSM Present) and C(FSM Future). The inbetween edge path from A to B or B to C will be a wormhole or QuantumTimeAndSpaceStream. To travel through this stream without our body being splashed across the cosmos, we need to enable QASI-Ve1 with Quantum-core-i1 as its blackbox engine, the Ve1 can easiy pass through any difficult space medium like blackhole, warmhole, QuantumTimeAndSpaceStream or etc with ease, as its a no mass, no code, GSpeed, QuantumAcceleratedSystem. I have explained very basic but will publish paper on this topic in few months.

## Future Scope

Test on real world objects using actual physical representations of proposed QASI-Ve1 with Quantum-core-i1

## Collaborate/Contact

Feel free to reach out at

Email1: <shiva-veldi@ai-assistant-idyll.com>

Email2: <exezexy9@gmail.com>

Email3: <vesolutions03@gmail.com>

## Usage (prototype)

This repo now includes a small, safe-by-default planning core based on FSMs and a graph engine that detects and rejects negative cycles. You can experiment locally without any quantum hardware.

Quick start:

- Requirements: Python 3.9+
- Install (dev mode):

  - Create a virtual environment (optional) and run installation.

- Example: plan an A→B→C→A cycle with edges and costs:

  The CLI accepts states, initial state, and edges of the form `src:dst:weight`.

Notes:

- The planner rejects graphs that contain negative cycles.
- You may allow negative edges (safe) or disallow them entirely with `--forbid-negative-edges`.
- Quantum backends are stubs; by default a Null backend is used. Real hardware integrations will come next.

