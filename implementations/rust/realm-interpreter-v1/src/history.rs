use crate::canonical::canonical_encode;
use serde_json::Value;
use sha2::{Digest, Sha256};

const KNOWN_EVENT_TYPES: &[&str] = &["ROOT_AUTHORITY_CREATED", "DEVICE_KEY_ISSUED"];

pub fn event_envelope<'a>(event: &'a Value) -> &'a Value {
    event
        .get("envelope")
        .filter(|value| value.is_object())
        .unwrap_or(event)
}

fn event_payload(event: &Value) -> &Value {
    event
        .get("payload")
        .filter(|value| value.is_object())
        .unwrap_or(&Value::Null)
}

fn has_realm_event_contract(event_type: &str) -> bool {
    KNOWN_EVENT_TYPES.contains(&event_type)
}

pub fn is_hash_chained_realm_event(event: &Value) -> bool {
    let envelope = event_envelope(event);
    let event_type = event
        .get("type")
        .or_else(|| envelope.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let realm_event = event
        .get("realm_event")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    has_realm_event_contract(event_type) && (realm_event || has_realm_event_contract(event_type))
}

pub fn realm_event_hash_material(event: &Value, previous_event_hash: Option<&str>) -> Value {
    let envelope = event_envelope(event);
    let previous = previous_event_hash
        .map(|value| Value::String(value.to_string()))
        .unwrap_or(Value::Null);

    serde_json::json!({
        "authority_reference": event.get("authority_reference")
            .or_else(|| envelope.get("authority_reference"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "payload": event_payload(event),
        "previous_event_hash": previous,
        "sequence": event.get("sequence")
            .or_else(|| envelope.get("sequence"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0) as i64,
        "signer": event.get("signer")
            .or_else(|| envelope.get("signer"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "type": event.get("type")
            .or_else(|| envelope.get("type"))
            .and_then(Value::as_str)
            .unwrap_or(""),
        "version": event.get("version")
            .or_else(|| envelope.get("version"))
            .and_then(Value::as_f64)
            .unwrap_or(1.0) as i64,
    })
}

pub fn calculate_realm_event_hash(event: &Value, previous_event_hash: Option<&str>) -> String {
    let material = realm_event_hash_material(event, previous_event_hash);
    let encoded = canonical_encode(&material);
    let digest = Sha256::digest(encoded.as_bytes());
    hex::encode(digest)
}

pub fn build_realm_event_id(event: &Value, current_event_hash: &str) -> String {
    let envelope = event_envelope(event);
    let event_type = event
        .get("type")
        .or_else(|| envelope.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("REALM_EVENT");
    let sequence = event
        .get("sequence")
        .or_else(|| envelope.get("sequence"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as i64;
    let hash_prefix = &current_event_hash[..current_event_hash.len().min(16)];
    format!(
        "realm_evt_{}_{}_{}",
        sequence,
        event_type.to_lowercase(),
        hash_prefix
    )
}

pub fn verify_realm_event_history(event_log: &[Value]) -> Result<(), String> {
    let mut expected_previous_hash: Option<String> = None;

    for event in event_log {
        if !is_hash_chained_realm_event(event) {
            continue;
        }

        let previous = event.get("previous_event_hash").and_then(Value::as_str);
        if previous != expected_previous_hash.as_deref() {
            let sequence = event
                .get("sequence")
                .or_else(|| event_envelope(event).get("sequence"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as i64;
            return Err(format!("REALM_EVENT_CHAIN_BROKEN:sequence_{sequence}"));
        }

        let recalculated_hash =
            calculate_realm_event_hash(event, expected_previous_hash.as_deref());
        let current_hash = event
            .get("current_event_hash")
            .and_then(Value::as_str)
            .unwrap_or("");
        if current_hash != recalculated_hash {
            let sequence = event
                .get("sequence")
                .or_else(|| event_envelope(event).get("sequence"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as i64;
            return Err(format!("REALM_EVENT_HASH_MISMATCH:sequence_{sequence}"));
        }

        let expected_event_id = build_realm_event_id(event, &recalculated_hash);
        let event_id = event.get("event_id").and_then(Value::as_str).unwrap_or("");
        let id = event.get("id").and_then(Value::as_str).unwrap_or("");
        if event_id != expected_event_id || id != expected_event_id {
            let sequence = event
                .get("sequence")
                .or_else(|| event_envelope(event).get("sequence"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0) as i64;
            return Err(format!("REALM_EVENT_ID_MISMATCH:sequence_{sequence}"));
        }

        expected_previous_hash = Some(recalculated_hash);
    }

    Ok(())
}

pub fn latest_realm_event_hash(event_log: &[Value]) -> Option<String> {
    for event in event_log.iter().rev() {
        if !is_hash_chained_realm_event(event) {
            continue;
        }
        return event
            .get("current_event_hash")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    None
}

pub fn read_jsonl(content: &str) -> Result<Vec<Value>, String> {
    content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).map_err(|error| format!("INVALID_JSONL:{error}")))
        .collect()
}

pub fn projection_hash(projection: &Value) -> String {
    let encoded = canonical_encode(projection);
    let digest = Sha256::digest(encoded.as_bytes());
    hex::encode(digest)
}

pub fn values_equal(left: &Value, right: &Value) -> bool {
    canonical_encode(left) == canonical_encode(right)
}
