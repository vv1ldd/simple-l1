use serde_json::Value;

pub fn canonical_encode(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => {
            if *b {
                "true".to_string()
            } else {
                "false".to_string()
            }
        }
        Value::Number(n) => serde_json::to_string(n).unwrap_or_else(|_| "null".to_string()),
        Value::String(s) => serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string()),
        Value::Array(items) => {
            let encoded: Vec<String> = items.iter().map(|entry| canonical_encode(entry)).collect();
            format!("[{}]", encoded.join(","))
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let pairs: Vec<String> = keys
                .iter()
                .filter_map(|key| map.get(*key).map(|value| (key, value)))
                .map(|(key, value)| {
                    format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap_or_else(|_| "\"\"".to_string()),
                        canonical_encode(value)
                    )
                })
                .collect();
            format!("{{{}}}", pairs.join(","))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encodes_sorted_object_keys() {
        let value = json!({"b": 2, "a": 1});
        assert_eq!(canonical_encode(&value), r#"{"a":1,"b":2}"#);
    }
}
