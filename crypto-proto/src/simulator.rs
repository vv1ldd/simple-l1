//! # SIMPLE-L1 Deterministic Discrete-Event Simulation Suite
//! 
//! Validates Physical Epistemic Recovery, Anti-Entropy, and Topological Healing
//! under Adversarial Network Conditions (Graph cuts, variable latency, Eclipse attempts).

use std::collections::{BTreeMap, VecDeque};
use crate::{State, Address, Intent, Sequencer};

// ==========================================
// 1. МОДЕЛЬ СЕТЕВОГО ПАКЕТА
// ==========================================

/// Типы сетевых сообщений в симулируемом эфире
#[derive(Clone, Debug)]
pub enum Message {
    /// Control Plane: Периодический анонс высоты (RFC-0008)
    KnowledgePulse { height: u64, root_hash: [u8; 32] },
    /// Control Plane: Запрос пропущенного диапазона (RFC-0008)
    RangeFetchRequest { start: u64, end: u64, requester: usize },
    /// Data Plane: Ответ с порцией финализированных данных
    RangeFetchResponse { blocks: Vec<SimBlock> },
    /// Data Plane: Ретрансляция сырого намерения (Gossip)
    IntentGossip(Intent),
}

/// Минимальная структура блока для симуляции
#[derive(Clone, Debug)]
pub struct SimBlock {
    pub height: u64,
    pub parent_hash: [u8; 32],
    pub intents: Vec<Intent>,
    pub state_root: [u8; 32],
}

/// Событие в дискретном времени
#[derive(Clone, Debug)]
pub struct Event {
    pub deliver_at_tick: u64,
    pub sender_idx: usize,
    pub receiver_idx: usize,
    pub message: Message,
}

// ==========================================
// 2. МОДЕЛЬ НОДЫ В ФИЗИЧЕСКОМ МИРЕ
// ==========================================

pub struct SimulatedNode {
    pub id: usize,
    pub name: String,
    pub state: State,
    pub committed_blocks: Vec<SimBlock>,
    pub mempool: Vec<Intent>,
    
    // Локальный трекер знаний о соседях
    pub peer_heights: BTreeMap<usize, u64>,
    pub is_syncing: bool,
}

impl SimulatedNode {
    pub fn new(id: usize, name: &str) -> Self {
        Self {
            id,
            name: name.to_string(),
            state: State::new(),
            committed_blocks: Vec::new(),
            mempool: Vec::new(),
            peer_heights: BTreeMap::new(),
            is_syncing: false,
        }
    }

    /// Локальный коммит искусственного блока (эмуляция консенсуса лидера)
    pub fn commit_local_block(&mut self, intents: Vec<Intent>) -> SimBlock {
        let parent_hash = if let Some(last) = self.committed_blocks.last() {
            last.state_root
        } else {
            [0u8; 32]
        };

        // Прогоняем через MDEK
        for intent in &intents {
            let _ = self.state.apply(intent);
        }

        let block = SimBlock {
            height: self.state.ledger_height,
            parent_hash,
            intents,
            state_root: self.state.root_hash(),
        };
        
        self.committed_blocks.push(block.clone());
        block
    }
}

// ==========================================
// 3. ДИСКРЕТНО-СОБЫТИЙНАЯ СРЕДА (SIMULATION ENGINE)
// ==========================================

pub struct RealitySimulator {
    pub current_tick: u64,
    pub nodes: Vec<SimulatedNode>,
    pub event_queue: VecDeque<Event>,
    
    // Физическая матрица связности: [A][B] = true означает физический линк
    pub topology: Vec<Vec<bool>>,
    
    // Глобальные метрики
    pub logs: Vec<String>,
}

impl RealitySimulator {
    pub fn new(node_names: Vec<&str>) -> Self {
        let n = node_names.len();
        let nodes = node_names.into_iter().enumerate()
            .map(|(id, name)| SimulatedNode::new(id, name))
            .collect();
        
        Self {
            current_tick: 0,
            nodes,
            event_queue: VecDeque::new(),
            // Изначально полная связность
            topology: vec![vec![true; n]; n],
            logs: Vec::new(),
        }
    }

    /// Принудительный топологический раскол (Adversarial Graph Cut / Eclipse)
    /// Изолирует ноду от всего остального мира.
    pub fn apply_eclipse_attack(&mut self, target_node_idx: usize) {
        self.logs.push(format!("[🔥 TICK {}] ADVERSARY TRIGGERS ECLIPSE ATTACK on Node {}!", self.current_tick, target_node_idx));
        let n = self.nodes.len();
        for i in 0..n {
            if i != target_node_idx {
                self.topology[target_node_idx][i] = false;
                self.topology[i][target_node_idx] = false;
            }
        }
    }

    /// Топологическое самолечение (Dynamic Shuffling / Reconnection)
    pub fn heal_topology(&mut self) {
        self.logs.push(format!("[✨ TICK {}] TOPOLOGY HEALED: Restoring all physical channels.", self.current_tick));
        let n = self.nodes.len();
        for i in 0..n {
            for j in 0..n {
                self.topology[i][j] = true;
            }
        }
    }

    /// Отправка сообщения с учетом топологии и переменной задержки (Network Skew)
    pub fn schedule_send(&mut self, from: usize, to: usize, msg: Message, base_latency: u64) {
        // Если физического соединения нет — пакет мгновенно теряется (Silent Drop)
        if !self.topology[from][to] {
            return; 
        }

        let deliver_at = self.current_tick + base_latency;
        let event = Event {
            deliver_at_tick: deliver_at,
            sender_idx: from,
            receiver_idx: to,
            message: msg,
        };

        // Вставляем в очередь, сохраняя сортировку по времени доставки
        let insert_pos = self.event_queue.iter().position(|e| e.deliver_at_tick > deliver_at)
            .unwrap_or(self.event_queue.len());
        self.event_queue.insert(insert_pos, event);
    }

    /// Один логический такт времени физического мира
    pub fn step(&mut self) {
        self.current_tick += 1;
        
        // 1. Периодическое испускание Knowledge Pulse нодами (RFC-0008 / Heartbeats)
        // Каждые 50 тактов каждая нода шлет анонс соседям.
        if self.current_tick % 50 == 0 {
            let n = self.nodes.len();
            for i in 0..n {
                let h = self.nodes[i].state.ledger_height;
                let rh = self.nodes[i].state.root_hash();
                
                for j in 0..n {
                    if i != j {
                        self.schedule_send(i, j, Message::KnowledgePulse { height: h, root_hash: rh }, 10);
                    }
                }
            }
        }

        // 2. Процессинг готовых к доставке пакетов
        while let Some(front) = self.event_queue.front() {
            if front.deliver_at_tick <= self.current_tick {
                let ev = self.event_queue.pop_front().unwrap();
                
                // Финальная физическая проверка на лету (могли оборвать кабель пока пакет летел!)
                if !self.topology[ev.sender_idx][ev.receiver_idx] {
                    continue;
                }
                
                self.handle_message(ev.sender_idx, ev.receiver_idx, ev.message);
            } else {
                break; // Очередь отсортирована, остальные события в будущем
            }
        }
    }

    /// Логика обработки физического пакета на уровне Антиэнтропии
    fn handle_message(&mut self, from: usize, to: usize, msg: Message) {
        match msg {
            Message::KnowledgePulse { height, root_hash: _ } => {
                // 1. Обновляем знание о соседе
                self.nodes[to].peer_heights.insert(from, height);
                
                let my_height = self.nodes[to].state.ledger_height;
                
                // 2. GAP DETECTION (RFC-0008 Section 6.2)
                if height > my_height && !self.nodes[to].is_syncing {
                    self.logs.push(format!(
                        "[👁️ TICK {}] Node {} detected Epistemic Lag (My H={}, Peer H={}). Initiating Range Fetch!",
                        self.current_tick, self.nodes[to].name, my_height, height
                    ));
                    
                    self.nodes[to].is_syncing = true;
                    
                    // Запрашиваем данные у соседа (Control Plane Request)
                    let req = Message::RangeFetchRequest {
                        start: my_height + 1,
                        end: height,
                        requester: to,
                    };
                    self.schedule_send(to, from, req, 10); // Малая задержка
                }
            }
            
            Message::RangeFetchRequest { start, end, requester } => {
                // Нода отвечает на запрос синхронизации (Data Plane Response)
                let mut blocks_to_send = Vec::new();
                
                for block in &self.nodes[to].committed_blocks {
                    if block.height >= start && block.height <= end {
                        blocks_to_send.push(block.clone());
                    }
                }
                
                let resp = Message::RangeFetchResponse { blocks: blocks_to_send };
                // Data Plane пакет тяжелее, имитируем большую задержку (40 тиков вместо 10)
                self.schedule_send(to, requester, resp, 40);
            }
            
            Message::RangeFetchResponse { blocks } => {
                // 3. RECONCILIATION LOOP (RFC-0008 Section 6.3)
                let node_name = self.nodes[to].name.clone();
                self.logs.push(format!(
                    "[🌀 TICK {}] Node {} received {} blocks. Reconciling...",
                    self.current_tick, node_name, blocks.len()
                ));
                
                for block in blocks {
                    // Накатываем в MDEK
                    for intent in &block.intents {
                        let _ = self.nodes[to].state.apply(&intent);
                    }
                    self.nodes[to].committed_blocks.push(block);
                }
                
                self.nodes[to].is_syncing = false;
                self.logs.push(format!(
                    "[💎 TICK {}] Node {} synchronization complete. New Height: {}",
                    self.current_tick, self.nodes[to].name, self.nodes[to].state.ledger_height
                ));
            }
            _ => {}
        }
    }

    /// Запуск симулятора на N тактов
    pub fn run_ticks(&mut self, ticks: u64) {
        for _ in 0..ticks {
            self.step();
        }
    }
}
