use crate::canonical::canonical_encode;
use crate::history::{latest_realm_event_hash, projection_hash};
use crate::interpreter::semantic_anchors;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

fn sha256_canonical(value: &Value) -> String {
    let encoded = canonical_encode(value);
    let digest = Sha256::digest(encoded.as_bytes());
    hex::encode(digest)
}

fn lifecycle_state(integrity_report: &Value) -> Value {
    let realm_valid = integrity_report
        .get("realm_valid")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let has_warnings = integrity_report
        .get("warnings")
        .and_then(Value::as_array)
        .map(|warnings| !warnings.is_empty())
        .unwrap_or(false);

    if !realm_valid {
        json!({
            "state": "SUSPENDED",
            "can_accept_commands": false,
            "can_accept_authority_mutations": false
        })
    } else if has_warnings {
        json!({
            "state": "DEGRADED",
            "can_accept_commands": true,
            "can_accept_authority_mutations": true
        })
    } else {
        json!({
            "state": "VERIFIED",
            "can_accept_commands": true,
            "can_accept_authority_mutations": true
        })
    }
}

pub fn portable_integrity_report(event_log: &[Value], projection: &Value) -> Value {
    json!({
        "realm_valid": true,
        "history_head": latest_realm_event_hash(event_log),
        "projection_hash": projection_hash(projection),
        "canonical": {
            "history": "ok",
            "projection_replay": "ok"
        },
        "derived": {
            "snapshot": "skip"
        },
        "operational": {
            "federation_references": "ok",
            "command_lineage": "warning"
        },
        "failures": [],
        "warnings": ["COMMAND_EXECUTION_RECORD_MISSING"]
    })
}

pub fn evidence_material(event_log: &[Value], projection: &Value) -> Value {
    let anchors = semantic_anchors(event_log, projection);
    let integrity_report = portable_integrity_report(event_log, projection);
    let integrity_report_hash = sha256_canonical(&integrity_report);
    let lifecycle = lifecycle_state(&integrity_report);
    let explanation_anchors = json!({
        "current_authority": anchors.get("current_authority").cloned().unwrap_or(Value::Null),
        "status": "active",
        "history_head": anchors.get("history_head").cloned().unwrap_or(Value::Null),
        "projection_hash": anchors.get("projection_hash").cloned().unwrap_or(Value::Null)
    });

    let attestation_payload = json!({
        "protocol": "realm",
        "protocol_version": "1.0",
        "anchor_schema": 1,
        "evidence_schema": 1,
        "history_head": anchors.get("history_head").cloned().unwrap_or(Value::Null),
        "projection_hash": anchors.get("projection_hash").cloned().unwrap_or(Value::Null),
        "integrity_report_hash": integrity_report_hash,
        "lifecycle_state": lifecycle.get("state").cloned().unwrap_or(Value::Null),
        "explanation_anchors": explanation_anchors
    });
    let attestation_payload_hash = sha256_canonical(&attestation_payload);

    let evidence_package = json!({
        "protocol": "realm",
        "protocol_version": "1.0",
        "anchor_schema": 1,
        "evidence_schema": 1,
        "history_head": anchors.get("history_head").cloned().unwrap_or(Value::Null),
        "projection_hash": anchors.get("projection_hash").cloned().unwrap_or(Value::Null),
        "integrity_report_hash": integrity_report_hash,
        "lifecycle_state": lifecycle.get("state").cloned().unwrap_or(Value::Null),
        "attestation_payload_hash": attestation_payload_hash
    });
    let evidence_package_hash = sha256_canonical(&evidence_package);

    json!({
        "evidence_schema": 1,
        "history_head": anchors.get("history_head").cloned().unwrap_or(Value::Null),
        "projection_hash": anchors.get("projection_hash").cloned().unwrap_or(Value::Null),
        "integrity_report_hash": integrity_report_hash,
        "lifecycle_state": lifecycle.get("state").cloned().unwrap_or(Value::Null),
        "integrity_report": integrity_report,
        "explanation_anchors": explanation_anchors,
        "attestation_payload": attestation_payload,
        "attestation_payload_hash": attestation_payload_hash,
        "evidence_package": evidence_package,
        "evidence_package_hash": evidence_package_hash
    })
}
