use crate::history::verify_realm_event_history;
use serde_json::{json, Value};

fn empty_projection() -> Value {
    json!({
        "rootAuthority": null,
        "recoveryAuthorities": [],
        "devices": [],
        "sessions": [],
        "federationTrusts": [],
        "lastSequence": 0
    })
}

fn independent_envelope(event: &Value) -> &Value {
    event
        .get("envelope")
        .filter(|value| value.is_object())
        .unwrap_or(event)
}

fn independent_payload(event: &Value) -> &Value {
    event
        .get("payload")
        .filter(|value| value.is_object())
        .unwrap_or(&Value::Null)
}

fn require_independent_v1(event: &Value, envelope: &Value) -> Result<(), String> {
    let version = event
        .get("version")
        .or_else(|| envelope.get("version"))
        .and_then(Value::as_f64)
        .unwrap_or(1.0) as i64;
    if version != 1 {
        let event_type = envelope
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("UNKNOWN");
        return Err(format!(
            "INDEPENDENT_INTERPRETER_UNSUPPORTED_EVENT_VERSION:{event_type}:version_{version}"
        ));
    }
    Ok(())
}

fn apply_root_authority_created(
    projection: Value,
    event: &Value,
    envelope: &Value,
    payload: &Value,
) -> Value {
    let root_id = payload
        .get("root_id")
        .or_else(|| envelope.get("authority_reference"))
        .or_else(|| envelope.get("signer"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let authority_ref = envelope
        .get("authority_reference")
        .or_else(|| envelope.get("signer"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let issued_at = envelope
        .get("timestamp")
        .or_else(|| event.get("timestamp"))
        .cloned()
        .unwrap_or(Value::Null);
    let issued_event = event
        .get("id")
        .or_else(|| event.get("event_id"))
        .cloned()
        .unwrap_or(Value::Null);
    let sequence = envelope
        .get("sequence")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as i64;

    let mut next = projection;
    next["rootAuthority"] = json!({
        "id": root_id,
        "authorityRef": authority_ref,
        "status": "active",
        "issuedAt": issued_at,
        "issuedEvent": issued_event
    });
    next["lastSequence"] = json!(sequence);
    next
}

fn apply_device_key_issued(
    projection: Value,
    event: &Value,
    envelope: &Value,
    payload: &Value,
) -> Value {
    let device_id = payload
        .get("device_id")
        .or_else(|| payload.get("device"))
        .or_else(|| payload.get("authority_ref"))
        .or_else(|| payload.get("device_authority"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let authority_ref = payload
        .get("authority_ref")
        .or_else(|| payload.get("device_authority"))
        .map(|value| value.as_str().map(str::to_string))
        .unwrap_or_else(|| Some(format!("device:{device_id}")))
        .unwrap_or_default();
    let public_key = payload
        .get("public_key")
        .or_else(|| payload.get("publicKey"))
        .cloned()
        .unwrap_or(Value::Null);
    let issued_at = envelope
        .get("timestamp")
        .or_else(|| event.get("timestamp"))
        .cloned()
        .unwrap_or(Value::Null);
    let issued_event = event
        .get("id")
        .or_else(|| event.get("event_id"))
        .cloned()
        .unwrap_or(Value::Null);
    let sequence = envelope
        .get("sequence")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as i64;

    let devices = projection
        .get("devices")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|device| {
            device.get("id").and_then(Value::as_str) != Some(device_id)
                && device.get("authorityRef").and_then(Value::as_str)
                    != Some(authority_ref.as_str())
        })
        .collect::<Vec<_>>();

    let mut next_devices = devices;
    next_devices.push(json!({
        "id": device_id,
        "authority": authority_ref,
        "authorityRef": authority_ref,
        "status": "active",
        "publicKey": public_key,
        "issuedAt": issued_at,
        "issuedEvent": issued_event,
        "revokedAt": null,
        "revokedEvent": null
    }));

    let mut next = projection;
    next["devices"] = Value::Array(next_devices);
    next["lastSequence"] = json!(sequence);
    next
}

pub fn build_independent_authority_state(event_log: &[Value]) -> Result<Value, String> {
    verify_realm_event_history(event_log)?;
    let mut projection = empty_projection();

    for event in event_log {
        if event.get("realm_event").and_then(Value::as_bool) != Some(true) {
            continue;
        }

        let envelope = independent_envelope(event);
        let payload = independent_payload(event);
        let event_type = envelope
            .get("type")
            .or_else(|| event.get("type"))
            .and_then(Value::as_str)
            .unwrap_or("");

        match event_type {
            "ROOT_AUTHORITY_CREATED" => {
                require_independent_v1(event, envelope)?;
                projection = apply_root_authority_created(projection, event, envelope, payload);
            }
            "DEVICE_KEY_ISSUED" => {
                require_independent_v1(event, envelope)?;
                projection = apply_device_key_issued(projection, event, envelope, payload);
            }
            other => {
                return Err(format!(
                    "INDEPENDENT_INTERPRETER_UNKNOWN_EVENT_TYPE:{other}"
                ));
            }
        }
    }

    Ok(projection)
}

pub fn authority_subjects(projection: &Value) -> Vec<Value> {
    let mut subjects = Vec::new();

    if let Some(root) = projection
        .get("rootAuthority")
        .filter(|value| !value.is_null())
    {
        let authority_ref = root
            .get("authorityRef")
            .or_else(|| root.get("id"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let status = root
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("active");
        subjects.push(json!({
            "kind": "root",
            "ref": authority_ref,
            "status": status
        }));
    }

    if let Some(devices) = projection.get("devices").and_then(Value::as_array) {
        for device in devices {
            let authority_ref = device
                .get("authorityRef")
                .or_else(|| device.get("authority"))
                .or_else(|| device.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let status = device
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or("active");
            subjects.push(json!({
                "kind": "device",
                "ref": authority_ref,
                "status": status
            }));
        }
    }

    subjects
}

pub fn semantic_anchors(event_log: &[Value], projection: &Value) -> Value {
    let canonical_event_count = event_log
        .iter()
        .filter(|event| event.get("realm_event").and_then(Value::as_bool) == Some(true))
        .count();
    let current_authority = projection
        .get("rootAuthority")
        .and_then(|root| {
            root.get("authorityRef")
                .or_else(|| root.get("id"))
                .and_then(Value::as_str)
        })
        .unwrap_or("");
    let last_sequence = projection
        .get("lastSequence")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as i64;

    json!({
        "anchor_schema": 1,
        "history_head": crate::history::latest_realm_event_hash(event_log),
        "projection_hash": crate::history::projection_hash(projection),
        "current_authority": if current_authority.is_empty() { Value::Null } else { json!(current_authority) },
        "last_sequence": last_sequence,
        "canonical_event_count": canonical_event_count,
        "authority_subjects": authority_subjects(projection)
    })
}
