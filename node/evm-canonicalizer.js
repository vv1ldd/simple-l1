'use strict';

const crypto = require('crypto');
const { canonicalJson } = require('./protocol-artifacts');

const ZERO_LOG_INDEX = null;
const TX_FACT_TYPE = 'EVM_TX';
const LOG_FACT_TYPE = 'EVM_LOG';
const TX_NODE_TYPE = 'EVM_TX_NODE';
const LOG_NODE_TYPE = 'EVM_LOG_NODE';
const ERC20_TRANSFER_NODE_TYPE = 'ERC20_TRANSFER_NODE';
const REVERT_NODE_TYPE = 'REVERT_NODE';
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function sha256(value) {
    return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function assertObject(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${name} must be an object`);
    }
    return value;
}

function requiredString(value, name) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is required`);
    }
    return value;
}

function normalizeHex(value, name) {
    const normalized = requiredString(value, name).toLowerCase();
    if (!/^0x[0-9a-f]*$/.test(normalized)) {
        throw new Error(`${name} must be 0x-prefixed lowercase-normalizable hex`);
    }
    return normalized;
}

function normalizeAddress(value, name) {
    const normalized = normalizeHex(value, name);
    if (!/^0x[0-9a-f]{40}$/.test(normalized)) {
        throw new Error(`${name} must be a 20-byte address`);
    }
    return normalized;
}

function normalizeHash(value, name) {
    const normalized = normalizeHex(value, name);
    if (!/^0x[0-9a-f]{64}$/.test(normalized)) {
        throw new Error(`${name} must be a 32-byte hash`);
    }
    return normalized;
}

function quantityToDecimalString(value, name) {
    if (typeof value === 'bigint') {
        return value.toString(10);
    }

    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`${name} must be a non-negative safe integer`);
        }
        return String(value);
    }

    if (typeof value === 'string') {
        if (/^0x[0-9a-fA-F]+$/.test(value)) {
            return BigInt(value).toString(10);
        }
        if (/^(0|[1-9][0-9]*)$/.test(value)) {
            return value;
        }
    }

    throw new Error(`${name} must be a non-negative decimal or hex quantity`);
}

function normalizeNullableHex(value, name) {
    if (value === null || value === undefined) {
        return null;
    }
    return normalizeHex(value, name);
}

function firstDefined(...values) {
    return values.find((value) => value !== undefined && value !== null);
}

function canonicalFactJson(fact) {
    return canonicalJson(fact);
}

function buildTxFactIdentity(fact) {
    return {
        block_hash: fact.block_hash,
        chain_id: fact.chain_id,
        receipt_status: fact.receipt_status,
        transaction_index: fact.transaction_index,
        tx_hash: fact.tx_hash,
    };
}

function buildLogFactIdentity(fact) {
    return {
        block_hash: fact.block_hash,
        chain_id: fact.chain_id,
        emitter_address: fact.emitter_address,
        event_signature: fact.event_signature,
        log_index: fact.log_index,
        raw_data: fact.raw_data,
        topics: fact.topics,
        tx_hash: fact.tx_hash,
    };
}

function buildTxNode(fact) {
    return {
        id: `evm_tx:${fact.fact_id}`,
        node_type: TX_NODE_TYPE,
        fact_id: fact.fact_id,
        inputs: {
            block_hash: fact.block_hash,
            chain_id: fact.chain_id,
            receipt_status: fact.receipt_status,
            transaction_index: fact.transaction_index,
            tx_hash: fact.tx_hash,
        },
        outputs: {
            fact_ref: fact.fact_id,
        },
        metadata: {
            semantic_interpretation_allowed: false,
            trace: 'canonical_evm_receipt',
        },
    };
}

function buildLogNode(fact) {
    return {
        id: `evm_log:${fact.fact_id}`,
        node_type: LOG_NODE_TYPE,
        fact_id: fact.fact_id,
        inputs: {
            chain_id: fact.chain_id,
            emitter_address: fact.emitter_address,
            event_signature: fact.event_signature,
            log_index: fact.log_index,
            topics: fact.topics,
            tx_hash: fact.tx_hash,
        },
        outputs: {
            fact_ref: fact.fact_id,
        },
        metadata: {
            semantic_interpretation_allowed: false,
            trace: 'canonical_evm_log',
        },
    };
}

function topicAddress(topic) {
    const normalized = normalizeHash(topic, 'erc20.topic_address');
    return `0x${normalized.slice(-40)}`;
}

function decodeUint256(data) {
    return BigInt(normalizeHex(data, 'erc20.raw_amount')).toString(10);
}

function decodeErc20Transfer(logFact) {
    if (logFact.event_signature !== ERC20_TRANSFER_TOPIC || logFact.topics.length < 3) {
        return null;
    }

    return {
        token_contract: logFact.emitter_address,
        from: topicAddress(logFact.topics[1]),
        to: topicAddress(logFact.topics[2]),
        raw_amount: decodeUint256(logFact.raw_data.data),
    };
}

function buildErc20TransferNode(logFact) {
    const decoded = decodeErc20Transfer(logFact);
    if (!decoded) {
        return null;
    }

    return {
        id: `erc20_transfer:${logFact.fact_id}`,
        node_type: ERC20_TRANSFER_NODE_TYPE,
        fact_id: logFact.fact_id,
        inputs: {
            chain_id: logFact.chain_id,
            log_index: logFact.log_index,
            raw_amount: decoded.raw_amount,
            token_contract: decoded.token_contract,
            topic_from: decoded.from,
            topic_to: decoded.to,
            tx_hash: logFact.tx_hash,
        },
        outputs: {
            fact_ref: logFact.fact_id,
        },
        metadata: {
            semantic_interpretation_allowed: false,
            trace: 'structural_erc20_transfer_decode',
        },
    };
}

function buildRevertNode(txFact) {
    if (txFact.receipt_status !== '0') {
        return null;
    }

    return {
        id: `evm_revert:${txFact.fact_id}`,
        node_type: REVERT_NODE_TYPE,
        fact_id: txFact.fact_id,
        inputs: {
            chain_id: txFact.chain_id,
            receipt_status: txFact.receipt_status,
            tx_hash: txFact.tx_hash,
        },
        outputs: {
            fact_ref: txFact.fact_id,
        },
        metadata: {
            semantic_interpretation_allowed: false,
            trace: 'canonical_evm_revert',
        },
    };
}

function buildFactGraph(facts, observation = null) {
    const txFact = facts[0];
    const logFacts = facts.slice(1);
    const nodes = [buildTxNode(txFact)];
    const edges = [];
    const revertNode = buildRevertNode(txFact);

    if (revertNode) {
        nodes.push(revertNode);
        edges.push({ from: `evm_tx:${txFact.fact_id}`, to: revertNode.id, ordering: 'after' });
    }

    for (const logFact of logFacts) {
        const logNode = buildLogNode(logFact);
        const erc20Node = buildErc20TransferNode(logFact);
        nodes.push(logNode);
        edges.push({ from: `evm_tx:${txFact.fact_id}`, to: logNode.id, ordering: 'after' });
        if (erc20Node) {
            nodes.push(erc20Node);
            edges.push({ from: logNode.id, to: erc20Node.id, ordering: 'after' });
        }
    }

    const graph = {
        schema_version: 'simple-l1.evm_fact_graph.v1',
        graph_type: 'deterministic_sdga_fact_graph',
        facts,
        sdga_projection: {
            nodes,
            edges,
        },
    };

    if (observation) {
        graph.observation = observation;
    }

    return graph;
}

function normalizeLog(log, txFact, index) {
    const logIndex = quantityToDecimalString(firstDefined(log.logIndex, log.log_index, index), `receipt.logs[${index}].logIndex`);
    const topics = (log.topics || []).map((topic, topicIndex) => normalizeHash(topic, `receipt.logs[${index}].topics[${topicIndex}]`));
    const factWithoutId = {
        fact_type: LOG_FACT_TYPE,
        chain_id: txFact.chain_id,
        block_number: txFact.block_number,
        block_hash: txFact.block_hash,
        tx_hash: normalizeHash(firstDefined(log.transactionHash, log.transaction_hash, txFact.tx_hash), `receipt.logs[${index}].transactionHash`),
        transaction_index: txFact.transaction_index,
        receipt_status: txFact.receipt_status,
        log_index: logIndex,
        emitter_address: normalizeAddress(log.address, `receipt.logs[${index}].address`),
        event_signature: topics[0] || null,
        topics,
        raw_data: {
            data: normalizeHex(firstDefined(log.data, '0x'), `receipt.logs[${index}].data`),
        },
        observed_at: txFact.observed_at,
        source: txFact.source,
        timestamp: txFact.timestamp,
    };
    return {
        fact_id: sha256(canonicalJson(buildLogFactIdentity(factWithoutId))),
        ...factWithoutId,
    };
}

function canonicalizeEthReceipt(input) {
    const payload = assertObject(input, 'raw_eth_receipt');
    const receipt = assertObject(payload.receipt, 'raw_eth_receipt.receipt');
    const transaction = assertObject(payload.transaction, 'raw_eth_receipt.transaction');
    const block = payload.block ? assertObject(payload.block, 'raw_eth_receipt.block') : {};

    const chainId = quantityToDecimalString(payload.chain_id, 'raw_eth_receipt.chain_id');
    const txHash = normalizeHash(firstDefined(receipt.transactionHash, receipt.transaction_hash, transaction.hash), 'receipt.transactionHash');
    const blockHash = normalizeHash(firstDefined(receipt.blockHash, receipt.block_hash), 'receipt.blockHash');
    const blockNumber = quantityToDecimalString(firstDefined(receipt.blockNumber, receipt.block_number), 'receipt.blockNumber');
    const transactionIndex = quantityToDecimalString(firstDefined(receipt.transactionIndex, receipt.transaction_index), 'receipt.transactionIndex');
    const receiptStatus = quantityToDecimalString(receipt.status, 'receipt.status');
    const from = normalizeAddress(firstDefined(transaction.from, receipt.from), 'transaction.from');
    const to = normalizeAddress(firstDefined(transaction.to, receipt.to), 'transaction.to');

    const factWithoutId = {
        fact_type: TX_FACT_TYPE,
        chain_id: chainId,
        block_number: blockNumber,
        block_hash: blockHash,
        tx_hash: txHash,
        transaction_index: transactionIndex,
        receipt_status: receiptStatus,
        log_index: ZERO_LOG_INDEX,
        emitter_address: null,
        event_signature: null,
        topics: [],
        raw_data: {
            effective_gas_price: quantityToDecimalString(firstDefined(receipt.effectiveGasPrice, receipt.effective_gas_price), 'receipt.effectiveGasPrice'),
            from,
            gas_used: quantityToDecimalString(firstDefined(receipt.gasUsed, receipt.gas_used), 'receipt.gasUsed'),
            input: normalizeNullableHex(firstDefined(transaction.input, transaction.data, '0x'), 'transaction.input'),
            to,
            value: quantityToDecimalString(transaction.value, 'transaction.value'),
        },
        observed_at: requiredString(payload.observed_at, 'raw_eth_receipt.observed_at'),
        source: requiredString(payload.source, 'raw_eth_receipt.source'),
        timestamp: block.timestamp === undefined || block.timestamp === null
            ? null
            : quantityToDecimalString(block.timestamp, 'block.timestamp'),
    };

    const factId = sha256(canonicalJson(buildTxFactIdentity(factWithoutId)));
    const fact = {
        fact_id: factId,
        ...factWithoutId,
    };
    const logsMissing = !Object.prototype.hasOwnProperty.call(receipt, 'logs');
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const facts = [fact, ...logs.map((log, index) => normalizeLog(log, fact, index))];
    const graph = buildFactGraph(facts, logsMissing ? {
        logs_status: 'missing',
        evidence_completeness: 'partial',
    } : null);

    return {
        canonical_fact: fact,
        canonical_fact_json: canonicalFactJson(fact),
        fact_id: factId,
        facts,
        facts_json: facts.map(canonicalFactJson),
        graph,
        graph_json: canonicalJson(graph),
    };
}

module.exports = {
    canonicalFactJson,
    canonicalizeEthReceipt,
    ERC20_TRANSFER_NODE_TYPE,
    ERC20_TRANSFER_TOPIC,
    LOG_FACT_TYPE,
    LOG_NODE_TYPE,
    REVERT_NODE_TYPE,
    TX_FACT_TYPE,
    TX_NODE_TYPE,
};
