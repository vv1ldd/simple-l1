# SIMPLE-L1 Technical Whitepaper

🌐 **English | [Español](./WHITEPAPER.es.md) | [Русский](./WHITEPAPER.ru.md)**

**Status:** Formal Specification (Formal Specification V1.0)  
**Classification:** Distributed Systems Research Framework with Executable Semantics  
**Date:** May 13, 2026  

---

## Abstract

**SIMPLE-L1** is a deterministic intent execution ledger with passkey-bound identities and replayable state:
> *«Deterministic intent execution ledger with passkey-bound identities and replayable state»*

Unlike traditional blockchains built around "transaction chains" and probabilistic consensus, SIMPLE-L1 is architected as a **Truth Machine** decoupled from the **Agreement Machine**. This document formalizes the completion of the first architectural loop, specifying 10 unified layers (RFC-0001–0010), the functional MDEK Rust kernel, and resilience verification results under active Byzantine network skew.

---

## 1. Rigid Invariants

The SIMPLE-L1 architecture cements five hard-coded engineering laws that are non-negotiable:

| Invariant | Technical Implementation | Core Effect |
| :--- | :--- | :--- |
| **1. Identity is hardware-bound** | NIST P-256 (WebAuthn) + Bech32m | Private key never leaves the chip (Secure Enclave). Zero-barrier onboarding without seed phrases. |
| **2. Intent-driven execution** | Canonical Borsh Serialization | The network signs human intents, not low-level raw transaction payloads. |
| **3. Pure determinism** | BTreeMap-isolated MDEK | `time()`, external calls, and hidden state are banned. `state' = apply(state, intent)` yields a 100% binary-identical hash on any CPU. |
| **4. Ban of the Wall Clock** | Logical Time (`ledger_height`) | Physical clocks are treated as an unreliable external oracle. Time is measured solely by ledger height. |
| **5. Forkless Core** | 2F+1 BFT Quorum Attestation | Immediate finality. The simultaneous creation of two finalized blocks is mathematically impossible. |

---

## 2. Unified Architecture (RFC Registry)

The system stack is comprehensively mapped across 10 interconnected specifications, closing the loop from bottom up:

*   **RFC-0001 & RFC-0002:** Hardware Cryptography (P-256) and Canonical Borsh Serialization.
*   **RFC-0003 & RFC-0004:** Monotonic Nonce Replay Protection and Block Structuring.
*   **RFC-0005:** Ledger Persistence via Atomic Disk `fsync` and Replay Recovery.
*   **RFC-0006:** Network Failure Assumptions and $3F+1$ Byzantine Adversary Model.
*   **RFC-0007:** Quorum Agreement, Epoch Leader Round-Robin, and Immediate Finality.
*   **RFC-0008:** Epistemic Perception Layer (Knowledge Pulse) and Anti-Entropy Self-Healing.
*   **RFC-0009:** Separation of Priority Signals (Control Plane) and High-Volume Payloads (Data Plane).
*   **RFC-0010:** Network Graph Geometry, Deterministic Chord Neighbor Selection, and Epoch Shuffling.

---

## 3. Executable Core (MDEK Kernel v0.1)

The physical rules of SIMPLE-L1 are compiled inside a reference Rust implementation (`simple-l1-kernel`):
1.  **State Mutator:** Executes pure, side-effect-free account balance mutations, validating constraints and protecting against numerical overflows.
2.  **Sequencer:** Employs a strict Double-Spend Shield. If multiple conflicting intents share the same signature nonce, the sequencer deterministically keeps exactly one based on the minimal `BLAKE3` hash, purging all equivocation attempts.

---

## 4. Verification & Closure (Simulation Closure)

SIMPLE-L1 has achieved **Formalized Simulation Closure** via its embedded Discrete-Event Distributed Emulator (`RealitySimulator`).

### 🧪 Validated Scenario (Eclipse Attack Recovery):
1.  Node "Charlie" is topologically isolated from the physical graph (Graph Cut).
2.  While Charlie is offline, the network produces new blocks. Charlie falls into deep informational divergence (Epistemic Lag).
3.  Charlie's physical connections are restored (Healing).
4.  Charlie detects the gap via the `Knowledge Pulse`, halts voting, successfully executes an atomic `Range Fetch`, and reconciles his local MDEK state to perfect bit-for-bit equivalence with the network's root hash.

---

## 5. Explicit Assumption Boundaries

To purge illusion and ensure scientific integrity, we document the explicit bounds under which our simulation correctness is proven:

| Assumption Domain | Status in Model | Physical Reality |
| :--- | :--- | :--- |
| **Message Delivery** | Guaranteed after `heal_topology` | High-packet loss, persistent NAT failures, and network jitter. |
| **Event Scheduling** | Globally ordered (Discrete-Event) | Non-deterministic OS scheduler preemptions and thread racing. |
| **Environment Stability** | Pure, stable Rust runtime | Potential hardware faults, CPU bit-flips, and OS time drift. |

**Conclusion:** This specification does not guarantee operation on the open internet but mathematically and algorithmically proves protocol invulnerability in an adversarial abstraction of the network.

---

## 6. Future Research Roadmaps (Next Horizons)

Three scientific vectors are set to transition SIMPLE-L1 beyond the laboratory boundary:
1.  **Reality Stress Path:** Integrating real physical network runtimes (`libp2p` / `QUIC`) and measuring performance under stochastic real-world network jitter.
2.  **Formal Verification Path:** Translating the consensus invariants into `TLA+` or `Coq` to formally prove Safety and Liveness properties.
3.  **Empirical Chaos Path:** Engineering an active, adaptive topology poisoner to stress-test and find the breakdown limits of the Anti-Entropy bounds.

---

## Repository Artifact References

*   `MANIFESTO.md` — Philosophical foundations and rigid core values.
*   `README.md` — The developer entrypoint and complete RFC catalog.
*   `crypto-proto/` — Rust source code for the MDEK kernel and reality simulator.
