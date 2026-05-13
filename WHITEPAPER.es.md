# SIMPLE-L1 Technical Whitepaper (Español)

🌐 **[English](./WHITEPAPER.md) | Español | [Русский](./WHITEPAPER.ru.md)**

**Estado:** Especificación Formal (Formal Specification V1.0)  
**Clasificación:** Distributed Systems Research Framework with Executable Semantics  
**Fecha:** 13 de mayo de 2026  

---

## Resumen (Abstract)

**SIMPLE-L1** es un registro determinista de ejecución de intenciones con identidades vinculadas a hardware (passkeys) y estado reproducible:
> *«Deterministic intent execution ledger with passkey-bound identities and replayable state»*

A diferencia de las blockchains tradicionales construidas en torno a "cadenas de transacciones" y consensos probabilísticos, SIMPLE-L1 está diseñado como una **Máquina de la Verdad** (Truth Machine) desacoplada de la **Máquina de Acuerdo** (Agreement Machine). Este documento formaliza la culminación del primer ciclo de diseño arquitectónico, especificando 10 capas unificadas (RFC-0001–0010), el núcleo funcional MDEK escrito en Rust y los resultados de verificación ante fallos bizantinos y asimetrías físicas de red.

---

## 1. Invariantes Rígidos (Rigid Invariants)

La arquitectura de SIMPLE-L1 consolida cinco leyes de ingeniería innegociables y codificadas de manera estricta:

| Invariante | Implementación Técnica | Efecto Principal |
| :--- | :--- | :--- |
| **1. La Identidad está ligada al Hardware** | NIST P-256 (WebAuthn) + Bech32m | La clave privada nunca sale del chip (Secure Enclave). Registro instantáneo sin frases semilla. |
| **2. Ejecución guiada por Intenciones** | Serialización Borsh Canónica | La red firma intenciones humanas (Intents), no transacciones de bajo nivel. |
| **3. Determinismo Puro** | MDEK aislado en BTreeMap | Prohibición total de `time()`, I/O o estados ocultos. `state' = apply(state, intent)` genera un hash 100% idéntico en cualquier CPU. |
| **4. Prohibición del Reloj de Pared** | Tiempo Lógico (`ledger_height`) | Los relojes físicos se consideran oráculos externos no confiables. El tiempo se mide solo por la altura del registro. |
| **5. Núcleo sin Bifurcaciones** | Atestación de Quórum BFT 2F+1 | Finalidad inmediata. La creación simultánea de dos bloques finalizados es matemáticamente imposible. |

---

## 2. Arquitectura Unificada (Registro de RFCs)

La pila tecnológica del sistema está mapeada detalladamente en 10 especificaciones interconectadas:

*   **RFC-0001 y RFC-0002:** Criptografía de hardware (P-256) y Serialización Borsh Canónica.
*   **RFC-0003 y RFC-0004:** Protección contra repeticiones mediante Nonces monótonos y estructura de Bloques.
*   **RFC-0005:** Persistencia en disco mediante `fsync` atómico y Recuperación por Reejecución (Replay).
*   **RFC-0006:** Hipótesis de fallos de red y Modelo de Adversario Bizantino $3F+1$.
*   **RFC-0007:** Acuerdo por Quórum, Liderazgo por Épocas (Round-Robin) y Finalidad Inmediata.
*   **RFC-0008:** Capa Epistémica de Percepción (Pulse de Conocimiento) y Auto-sanación por Anti-Entropía.
*   **RFC-0009:** Separación de Señales de Control (Control Plane) y Cargas de Datos Pesados (Data Plane).
*   **RFC-0010:** Geometría del Grafo de Red, Selección Determinista de Vecinos (Chord) y Reorganización Dinámica de Épocas.

---

## 3. Núcleo Ejecutable (MDEK Kernel v0.1)

Las reglas físicas de SIMPLE-L1 están implementadas en la biblioteca de referencia en Rust (`simple-l1-kernel`):
1.  **State Mutator:** Ejecuta mutaciones de saldo puras, validando límites y previniendo desbordamientos matemáticos.
2.  **Sequencer:** Emplea un Escudo contra Doble Gasto determinista. Si existen múltiples intenciones en conflicto con el mismo Nonce, el secuenciador conserva exactamente una basada en el hash `BLAKE3` mínimo de la firma, descartando cualquier intento de equivocidad.

---

## 4. Verificación y Cierre de Simulación (Simulation Closure)

SIMPLE-L1 ha alcanzado el estado de **Formalized Simulation Closure** utilizando su emulador de eventos discretos integrado (`RealitySimulator`).

### 🧪 Escenario Validado (Recuperación de Ataque Eclipse):
1.  El nodo "Charlie" queda aislado físicamente del grafo de red (Corte de Grafo).
2.  Mientras Charlie está desconectado, la red genera nuevos bloques. Charlie sufre una divergencia de información profunda (Epistemic Lag).
3.  Se restauran los enlaces físicos de comunicación (Sanación de Topología).
4.  Charlie detecta la desconexión a través del `Knowledge Pulse`, frena votaciones y realiza con éxito un `Range Fetch` atómico, reconciliando su estado MDEK hasta obtener una equivalencia binaria bit por bit con el State Root global de la red.

---

## 5. Límites Explícitos de Hipótesis (Assumptions)

Para garantizar rigor científico, documentamos los límites bajo los cuales se prueba la corrección de nuestra simulación:

| Categoría de Hipótesis | Estado en el Modelo | Realidad Física Externa |
| :--- | :--- | :--- |
| **Entrega de Mensajes** | Garantizada tras `heal_topology` | Pérdida de paquetes constante, fallos de NAT y latencia estocástica (Jitter). |
| **Planificación de Eventos** | Global y ordenada cronológicamente | Imprevisibilidad del planificador del SO y condiciones de carrera (Threads). |
| **Estabilidad del Entorno** | Entorno puro y estable en Rust | Errores físicos en hardware, CPU bit-flips y deriva del reloj del sistema. |

**Conclusión:** Esta especificación no garantiza su funcionamiento nativo en el Internet abierto, pero demuestra matemáticamente la invulnerabilidad algorítmica del protocolo ante una abstracción de red controlada y hostil.

---

## 6. Próximos Horizontes de Investigación (Next Horizons)

Se han definido tres vectores científicos para llevar el proyecto más allá del entorno de laboratorio:
1.  **Reality Stress Path:** Integración de una red real (`libp2p` / `QUIC`) midiendo la resistencia bajo el jitter stocástico global.
2.  **Formal Verification Path:** Traducción de los invariantes del consenso a lenguajes como `TLA+` o `Coq` para la demostración formal de propiedades de Safety y Liveness.
3.  **Empirical Chaos Path:** Creación de un mutador de topologías dinámico para hallar los límites de ruptura de los algoritmos de Anti-Entropía.

---

## Referencias de Artefactos del Repositorio

*   `MANIFESTO.md` — Fundamentos filosóficos y valores principales.
*   `README.md` — El portal para desarrolladores y catálogo completo de RFCs.
*   `crypto-proto/` — Código fuente en Rust del núcleo MDEK y el simulador de realidad física.
