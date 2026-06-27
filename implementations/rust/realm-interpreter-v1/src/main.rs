mod canonical;
mod conformance;
mod evidence;
mod history;
mod interpreter;

use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process;

fn usage() -> String {
    [
        "Usage:",
        "  realm-interpreter --profile core --vectors <path>",
        "  realm-interpreter --replay <history.jsonl>",
        "  realm-interpreter --evidence <history.jsonl>",
        "  realm-interpreter --export-authority-basic",
        "",
        "Runs the Realm Protocol v1 Core conformance corpus against this interpreter.",
        "The --replay mode prints semantic anchors JSON for cross-language equality checks.",
        "The --evidence mode prints portable evidence material JSON for interoperability checks.",
        "The --export-authority-basic mode prints canonical history JSONL for exchange tests.",
    ]
    .join("\n")
}

struct CliArgs {
    profile: String,
    vectors: PathBuf,
    replay: Option<PathBuf>,
    evidence: Option<PathBuf>,
    export_authority_basic: bool,
}

fn parse_args(args: &[String]) -> Result<CliArgs, String> {
    let mut profile = "core".to_string();
    let mut vectors = PathBuf::from("docs/protocol/v1/vectors");
    let mut replay = None;
    let mut evidence = None;
    let mut export_authority_basic = false;

    let mut index = 0;
    while index < args.len() {
        match args[index].as_str() {
            "--help" | "-h" => {
                println!("{}", usage());
                process::exit(0);
            }
            "--profile" => {
                index += 1;
                profile = args
                    .get(index)
                    .ok_or_else(|| "MISSING_PROFILE".to_string())?
                    .clone();
            }
            "--vectors" => {
                index += 1;
                vectors = PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "MISSING_VECTORS".to_string())?,
                );
            }
            "--replay" => {
                index += 1;
                replay = Some(PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "MISSING_REPLAY_HISTORY".to_string())?,
                ));
            }
            "--evidence" => {
                index += 1;
                evidence = Some(PathBuf::from(
                    args.get(index)
                        .ok_or_else(|| "MISSING_EVIDENCE_HISTORY".to_string())?,
                ));
            }
            "--export-authority-basic" => {
                export_authority_basic = true;
            }
            other => return Err(format!("UNKNOWN_ARGUMENT:{other}")),
        }
        index += 1;
    }

    Ok(CliArgs {
        profile,
        vectors,
        replay,
        evidence,
        export_authority_basic,
    })
}

fn attach_realm_event_hash_chain(mut event: Value, previous_event_hash: Option<&str>) -> Value {
    let current_event_hash = history::calculate_realm_event_hash(&event, previous_event_hash);
    let event_id = history::build_realm_event_id(&event, &current_event_hash);
    event["id"] = json!(event_id);
    event["event_id"] = json!(event_id);
    event["previous_event_hash"] = previous_event_hash
        .map(|hash| json!(hash))
        .unwrap_or(Value::Null);
    event["current_event_hash"] = json!(current_event_hash);
    event
}

fn authority_basic_history() -> Vec<Value> {
    let root = json!({
        "type": "ROOT_AUTHORITY_CREATED",
        "realm_event": true,
        "version": 1,
        "projection_version": 1,
        "envelope": {
            "type": "ROOT_AUTHORITY_CREATED",
            "signer": "fixture_root_ref",
            "authority_reference": "fixture_root_ref",
            "sequence": 1,
            "timestamp": "2026-06-27T00:00:00.000Z",
            "previous_event_hash": null
        },
        "payload": {
            "root_id": "fixture_root",
            "public_key": "pk_fixture_root"
        },
        "signer": "fixture_root_ref",
        "authority_reference": "fixture_root_ref",
        "sequence": 1,
        "timestamp": "2026-06-27T00:00:00.000Z",
        "accepted_at": "2026-06-27T00:00:00.000Z"
    });
    let root = attach_realm_event_hash_chain(root, None);
    let previous_hash = root
        .get("current_event_hash")
        .and_then(Value::as_str)
        .map(str::to_string);

    let device = json!({
        "type": "DEVICE_KEY_ISSUED",
        "realm_event": true,
        "version": 1,
        "projection_version": 1,
        "envelope": {
            "type": "DEVICE_KEY_ISSUED",
            "signer": "fixture_root_ref",
            "authority_reference": "fixture_root_ref",
            "sequence": 2,
            "timestamp": "2026-06-27T00:00:00.000Z",
            "previous_event_hash": null
        },
        "payload": {
            "device": "fixture_device_01",
            "publicKey": "pk_fixture_device",
            "device_authority": "device:fixture_device_01"
        },
        "signer": "fixture_root_ref",
        "authority_reference": "fixture_root_ref",
        "sequence": 2,
        "timestamp": "2026-06-27T00:00:00.000Z",
        "accepted_at": "2026-06-27T00:00:00.000Z"
    });
    let device = attach_realm_event_hash_chain(device, previous_hash.as_deref());

    vec![root, device]
}

fn emit_authority_basic_history() -> Result<(), String> {
    for event in authority_basic_history() {
        let line = serde_json::to_string(&event)
            .map_err(|error| format!("HISTORY_ENCODE_FAILED:{error}"))?;
        println!("{line}");
    }
    Ok(())
}

fn emit_replay_anchors(history_path: &PathBuf) -> Result<(), String> {
    let content = fs::read_to_string(history_path)
        .map_err(|error| format!("READ_FAILED:{history_path:?}:{error}"))?;
    let event_log = history::read_jsonl(&content)?;
    let projection = interpreter::build_independent_authority_state(&event_log)?;
    let anchors = interpreter::semantic_anchors(&event_log, &projection);
    let encoded = serde_json::to_string_pretty(&anchors)
        .map_err(|error| format!("ANCHOR_ENCODE_FAILED:{error}"))?;
    io::stdout()
        .write_all(encoded.as_bytes())
        .map_err(|error| format!("ANCHOR_WRITE_FAILED:{error}"))?;
    Ok(())
}

fn emit_evidence_material(history_path: &PathBuf) -> Result<(), String> {
    let content = fs::read_to_string(history_path)
        .map_err(|error| format!("READ_FAILED:{history_path:?}:{error}"))?;
    let event_log = history::read_jsonl(&content)?;
    let projection = interpreter::build_independent_authority_state(&event_log)?;
    let material = evidence::evidence_material(&event_log, &projection);
    let encoded = serde_json::to_string_pretty(&material)
        .map_err(|error| format!("EVIDENCE_ENCODE_FAILED:{error}"))?;
    io::stdout()
        .write_all(encoded.as_bytes())
        .map_err(|error| format!("EVIDENCE_WRITE_FAILED:{error}"))?;
    Ok(())
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let cli = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("{message}");
            eprintln!("{}", usage());
            process::exit(1);
        }
    };

    if cli.export_authority_basic {
        match emit_authority_basic_history() {
            Ok(()) => {}
            Err(message) => {
                eprintln!("realm-interpreter: {message}");
                process::exit(1);
            }
        }
        return;
    }

    if let Some(history_path) = cli.replay {
        match emit_replay_anchors(&history_path) {
            Ok(()) => {}
            Err(message) => {
                eprintln!("realm-interpreter: {message}");
                process::exit(1);
            }
        }
        return;
    }

    if let Some(history_path) = cli.evidence {
        match emit_evidence_material(&history_path) {
            Ok(()) => {}
            Err(message) => {
                eprintln!("realm-interpreter: {message}");
                process::exit(1);
            }
        }
        return;
    }

    if cli.profile != "core" {
        eprintln!("UNSUPPORTED_CONFORMANCE_PROFILE:{}", cli.profile);
        eprintln!("{}", usage());
        process::exit(1);
    }

    match conformance::run_core_profile(&cli.vectors) {
        Ok(()) => {
            println!(
                "realm-interpreter: core conformance passed ({})",
                cli.vectors.display()
            );
        }
        Err(message) => {
            eprintln!("realm-interpreter: {message}");
            process::exit(1);
        }
    }
}
