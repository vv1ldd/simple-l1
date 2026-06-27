use crate::canonical::canonical_encode;
use crate::history::values_equal;
use crate::interpreter::{build_independent_authority_state, semantic_anchors};
use hmac::{Hmac, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

type HmacSha256 = Hmac<Sha256>;

const KNOWN_EVENT_TYPES: &[&str] = &[
    "ROOT_AUTHORITY_CREATED",
    "DEVICE_KEY_ISSUED",
    "SESSION_AUTHORITY_ISSUED",
];

#[derive(Debug)]
pub struct ValidationResult {
    pub ok: bool,
    pub reason_codes: Vec<String>,
}

fn normalize_proposal(proposal: &Value) -> Value {
    let envelope = proposal
        .get("envelope")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| proposal.clone());
    let payload = proposal
        .get("payload")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "envelope": envelope,
        "payload": payload
    })
}

fn is_non_empty_string(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_str)
        .map(|text| !text.trim().is_empty())
        .unwrap_or(false)
}

fn validate_envelope(envelope: &Value) -> Vec<String> {
    let mut reason_codes = Vec::new();
    let event_type = envelope.get("type").and_then(Value::as_str).unwrap_or("");
    if !is_non_empty_string(envelope.get("type")) {
        reason_codes.push("ENVELOPE_TYPE_REQUIRED".to_string());
    }
    if !KNOWN_EVENT_TYPES.contains(&event_type) {
        reason_codes.push("UNKNOWN_REALM_EVENT_TYPE".to_string());
        return reason_codes;
    }

    if !is_non_empty_string(envelope.get("signer")) {
        reason_codes.push("ENVELOPE_SIGNER_REQUIRED".to_string());
    }
    if !is_non_empty_string(envelope.get("authority_reference")) {
        reason_codes.push("ENVELOPE_AUTHORITY_REFERENCE_REQUIRED".to_string());
    }
    let sequence = envelope.get("sequence").and_then(Value::as_f64);
    if sequence.map(|value| value >= 1.0 && value.fract() == 0.0) != Some(true) {
        reason_codes.push("ENVELOPE_SEQUENCE_INVALID".to_string());
    }
    if !is_non_empty_string(envelope.get("timestamp")) {
        reason_codes.push("ENVELOPE_TIMESTAMP_REQUIRED".to_string());
    }
    reason_codes
}

fn is_active_root(state: &Value, signer_ref: &str) -> bool {
    state
        .get("rootAuthority")
        .filter(|root| !root.is_null())
        .and_then(|root| {
            root.get("authorityRef")
                .or_else(|| root.get("id"))
                .and_then(Value::as_str)
        })
        .map(|authority_ref| {
            authority_ref == signer_ref && state_pointer_status(state, "rootAuthority") == "active"
        })
        .unwrap_or(false)
}

fn state_pointer_status<'a>(state: &'a Value, pointer: &str) -> &'a str {
    state
        .get(pointer)
        .and_then(|value| value.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("active")
}

fn is_active_device(state: &Value, signer_ref: &str) -> bool {
    state
        .get("devices")
        .and_then(Value::as_array)
        .map(|devices| {
            devices.iter().any(|device| {
                let authority_ref = device
                    .get("authorityRef")
                    .or_else(|| device.get("authority"))
                    .or_else(|| device.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                authority_ref == signer_ref
                    && device.get("status").and_then(Value::as_str) == Some("active")
            })
        })
        .unwrap_or(false)
}

fn can_signer_issue_event(state: &Value, signer_ref: &str, event_type: &str) -> bool {
    match event_type {
        "ROOT_AUTHORITY_CREATED" => {
            state.get("rootAuthority").map_or(false, Value::is_null) && !signer_ref.is_empty()
        }
        "DEVICE_KEY_ISSUED" | "SESSION_AUTHORITY_ISSUED" => {
            is_active_root(state, signer_ref) || is_active_device(state, signer_ref)
        }
        _ => false,
    }
}

fn validate_authority_transition(state: &Value, envelope: &Value) -> Vec<String> {
    let event_type = envelope.get("type").and_then(Value::as_str).unwrap_or("");
    if !KNOWN_EVENT_TYPES.contains(&event_type) {
        return vec!["UNKNOWN_REALM_EVENT_TYPE".to_string()];
    }
    let signer = envelope.get("signer").and_then(Value::as_str).unwrap_or("");
    if !can_signer_issue_event(state, signer, event_type) {
        return vec!["AUTHORITY_TRANSITION_DENIED".to_string()];
    }
    Vec::new()
}

pub fn validate_realm_event_proposal(state: &Value, proposal: &Value) -> ValidationResult {
    let normalized = normalize_proposal(proposal);
    let envelope = normalized
        .get("envelope")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let mut reason_codes = validate_envelope(&envelope);
    if reason_codes.is_empty() {
        reason_codes.extend(validate_authority_transition(state, &envelope));
    }
    ValidationResult {
        ok: reason_codes.is_empty(),
        reason_codes,
    }
}

fn device_proposal_signing_material(proposal: &Value) -> Value {
    let envelope = proposal
        .get("envelope")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| proposal.clone());
    let payload = proposal
        .get("payload")
        .filter(|value| value.is_object())
        .cloned()
        .unwrap_or_else(|| json!({}));
    json!({
        "authority_reference": envelope.get("authority_reference").and_then(Value::as_str).unwrap_or("").trim(),
        "payload": payload,
        "sequence": envelope.get("sequence").and_then(Value::as_f64).unwrap_or(0.0) as i64,
        "signer": envelope.get("signer").and_then(Value::as_str).unwrap_or("").trim(),
        "type": envelope.get("type").and_then(Value::as_str).unwrap_or("").trim(),
    })
}

fn sign_device_proposal(proposal: &Value, public_key: &str) -> String {
    let material = device_proposal_signing_material(proposal);
    let encoded = canonical_encode(&material);
    let mut mac =
        HmacSha256::new_from_slice(public_key.as_bytes()).expect("HMAC accepts any key length");
    mac.update(encoded.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn active_device_for_signer(state: &Value, signer_ref: &str) -> Option<Value> {
    state
        .get("devices")
        .and_then(Value::as_array)?
        .iter()
        .find(|device| {
            let authority_ref = device
                .get("authorityRef")
                .or_else(|| device.get("authority"))
                .or_else(|| device.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("");
            authority_ref == signer_ref
                && device.get("status").and_then(Value::as_str) == Some("active")
        })
        .cloned()
}

pub fn verify_device_signature(state: &Value, signed_proposal: &Value) -> ValidationResult {
    let proposal = signed_proposal.get("proposal").unwrap_or(signed_proposal);
    let signature = signed_proposal
        .get("signature")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let normalized = normalize_proposal(proposal);
    let signer = normalized
        .get("envelope")
        .and_then(|envelope| envelope.get("signer"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let device = match active_device_for_signer(state, signer) {
        Some(device) => device,
        None => {
            return ValidationResult {
                ok: false,
                reason_codes: vec!["DEVICE_SIGNER_NOT_ACTIVE".to_string()],
            };
        }
    };
    let public_key = device
        .get("publicKey")
        .or_else(|| device.get("public_key"))
        .and_then(Value::as_str)
        .unwrap_or("");
    if public_key.is_empty() {
        return ValidationResult {
            ok: false,
            reason_codes: vec!["DEVICE_PUBLIC_KEY_MISSING".to_string()],
        };
    }
    if signature.is_empty() {
        return ValidationResult {
            ok: false,
            reason_codes: vec!["DEVICE_SIGNATURE_REQUIRED".to_string()],
        };
    }
    let expected = sign_device_proposal(&normalized, public_key);
    if signature != expected {
        return ValidationResult {
            ok: false,
            reason_codes: vec!["DEVICE_SIGNATURE_INVALID".to_string()],
        };
    }
    ValidationResult {
        ok: true,
        reason_codes: Vec::new(),
    }
}

fn read_json(path: &Path) -> Result<Value, String> {
    let content =
        fs::read_to_string(path).map_err(|error| format!("READ_FAILED:{path:?}:{error}"))?;
    serde_json::from_str(&content).map_err(|error| format!("INVALID_JSON:{path:?}:{error}"))
}

fn read_jsonl_file(path: &Path) -> Result<Vec<Value>, String> {
    let content =
        fs::read_to_string(path).map_err(|error| format!("READ_FAILED:{path:?}:{error}"))?;
    crate::history::read_jsonl(&content)
}

fn matches_expected_reason(message: &str, expected: &Value) -> bool {
    let reason = expected.get("reason").and_then(Value::as_str).unwrap_or("");
    if message.contains(reason) {
        return true;
    }
    expected
        .get("runtime_reason_aliases")
        .and_then(Value::as_array)
        .map(|aliases| {
            aliases
                .iter()
                .filter_map(Value::as_str)
                .any(|alias| message.contains(alias))
        })
        .unwrap_or(false)
}

fn matches_result_reason(result: &ValidationResult, expected: &Value) -> bool {
    if result.ok {
        return false;
    }
    result
        .reason_codes
        .iter()
        .any(|code| matches_expected_reason(code, expected))
}

fn run_history_negative(vector_dir: &Path, expected: &Value) -> Result<(), String> {
    let history_path = vector_dir.join("history.jsonl");
    let event_log = read_jsonl_file(&history_path)?;
    let result = build_independent_authority_state(&event_log);
    match result {
        Ok(_) => Err(format!(
            "NEGATIVE_VECTOR_ACCEPTED_UNEXPECTEDLY:{}",
            vector_dir.display()
        )),
        Err(message) if matches_expected_reason(&message, expected) => Ok(()),
        Err(message) => Err(format!(
            "NEGATIVE_VECTOR_REASON_MISMATCH:{}:{}",
            vector_dir.display(),
            message
        )),
    }
}

fn run_proposal_negative(
    vector_dir: &Path,
    expected: &Value,
    ledger_history: &[Value],
) -> Result<(), String> {
    let proposal_path = vector_dir.join("proposal.json");
    let signed_proposal_path = vector_dir.join("signed-proposal.json");
    let state = build_independent_authority_state(ledger_history)?;

    if proposal_path.exists() {
        let proposal = read_json(&proposal_path)?;
        let result = validate_realm_event_proposal(&state, &proposal);
        if matches_result_reason(&result, expected) {
            return Ok(());
        }
        return Err(format!(
            "PROPOSAL_NEGATIVE_REASON_MISMATCH:{}:{:?}",
            vector_dir.display(),
            result.reason_codes
        ));
    }

    if signed_proposal_path.exists() {
        let signed_proposal = read_json(&signed_proposal_path)?;
        let result = verify_device_signature(&state, &signed_proposal);
        if matches_result_reason(&result, expected) {
            return Ok(());
        }
        return Err(format!(
            "SIGNATURE_NEGATIVE_REASON_MISMATCH:{}:{:?}",
            vector_dir.display(),
            result.reason_codes
        ));
    }

    Err(format!(
        "NEGATIVE_VECTOR_MISSING_PROPOSAL:{}",
        vector_dir.display()
    ))
}

fn run_canonical_vector(vector_dir: &Path) -> Result<(), String> {
    let history_path = vector_dir.join("history.jsonl");
    let expected_state_path = vector_dir.join("expected-state.json");
    let expected_anchors_path = vector_dir.join("expected-anchors.json");

    let event_log = read_jsonl_file(&history_path)?;
    let projection = build_independent_authority_state(&event_log)?;
    let anchors = semantic_anchors(&event_log, &projection);
    let expected_state = read_json(&expected_state_path)?;
    let expected_anchors = read_json(&expected_anchors_path)?;

    if !values_equal(&projection, &expected_state) {
        return Err(format!("CANONICAL_STATE_MISMATCH:{}", vector_dir.display()));
    }
    if !values_equal(&anchors, &expected_anchors) {
        return Err(format!(
            "CANONICAL_ANCHORS_MISMATCH:{}",
            vector_dir.display()
        ));
    }
    Ok(())
}

fn list_vector_dirs(parent: &Path) -> Result<Vec<PathBuf>, String> {
    let mut dirs = Vec::new();
    for entry in
        fs::read_dir(parent).map_err(|error| format!("READ_DIR_FAILED:{parent:?}:{error}"))?
    {
        let entry = entry.map_err(|error| format!("READ_DIR_ENTRY_FAILED:{error}"))?;
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    Ok(dirs)
}

pub fn run_core_profile(vectors_root: &Path) -> Result<(), String> {
    if vectors_root
        .join("canonical")
        .join("authority-basic")
        .join("history.jsonl")
        .exists()
    {
        // Standard layout: vectors/canonical/* and vectors/negative/*
    } else {
        return Err(format!("VECTORS_ROOT_INVALID:{}", vectors_root.display()));
    }

    let authority_basic_history = read_jsonl_file(
        &vectors_root
            .join("canonical")
            .join("authority-basic")
            .join("history.jsonl"),
    )?;

    let mut executed = HashSet::new();

    for vector_dir in list_vector_dirs(&vectors_root.join("canonical"))? {
        run_canonical_vector(&vector_dir)?;
        executed.insert(
            vector_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string(),
        );
    }

    for vector_dir in list_vector_dirs(&vectors_root.join("negative"))? {
        let expected = read_json(&vector_dir.join("expected-result.json"))?;
        if vector_dir.join("history.jsonl").exists() {
            run_history_negative(&vector_dir, &expected)?;
        } else {
            run_proposal_negative(&vector_dir, &expected, &authority_basic_history)?;
        }
        executed.insert(
            vector_dir
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("")
                .to_string(),
        );
    }

    if executed.is_empty() {
        return Err("NO_CONFORMANCE_VECTORS_FOUND".to_string());
    }

    Ok(())
}
