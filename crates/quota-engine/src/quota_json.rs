use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{value::RawValue, Map, Value};
use std::fmt;

const EXACT_AMOUNTS: &[&str] = &[
    "balance",
    "balanceMicroCents",
    "cashBalance",
    "giftBalance",
    "used",
    "limit",
    "remaining",
    "total_capacity_size",
    "total_capacity_used",
    "CycleTotalCapacity",
    "CycleRemainCapacity",
    "CycleFrozenCapacity",
    "total_units",
    "used_units",
    "remaining_units",
    "available_units",
    "CycleCapacitySize",
    "CycleCapacityRemain",
    "CapacitySize",
    "CapacityRemain",
    "usedMicroCents",
    "limitMicroCents",
];

/// Decode the HTTP response body with the Electron numeric lexeme contract.
/// Only provider amount fields are materialized as decimal text.
pub fn decode_body(adapter: &str, body: &[u8]) -> serde_json::Result<Value> {
    let text = String::from_utf8_lossy(body);
    let json = if adapter == "gemini-web" {
        let text = text.trim();
        text.strip_prefix(")]}'").map_or(text, str::trim_start)
    } else {
        &text
    };
    decode(json, 0)
}

fn decode(text: &str, depth: u16) -> serde_json::Result<Value> {
    let mut deserializer = serde_json::Deserializer::from_str(text);
    let value = JsonValue(depth).deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(value)
}

#[derive(Clone, Copy)]
struct JsonValue(u16);

impl<'de> DeserializeSeed<'de> for JsonValue {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        if self.0 >= 128 {
            return Err(de::Error::custom("quota JSON nesting limit exceeded"));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for JsonValue {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a valid quota JSON value")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::from(value))
    }

    fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<S: SeqAccess<'de>>(self, mut sequence: S) -> Result<Value, S::Error> {
        let mut result = Vec::new();
        while let Some(entry) = sequence.next_element_seed(JsonValue(self.0 + 1))? {
            result.push(entry);
        }
        Ok(Value::Array(result))
    }

    fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Value, M::Error> {
        let mut result = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            let value = if EXACT_AMOUNTS.contains(&key.as_str()) {
                let raw = map.next_value::<&RawValue>()?.get();
                if matches!(raw.as_bytes().first(), Some(b'-' | b'0'..=b'9')) {
                    Value::from(raw)
                } else {
                    decode(raw, self.0 + 1).map_err(de::Error::custom)?
                }
            } else {
                map.next_value_seed(JsonValue(self.0 + 1))?
            };
            result.insert(key, value);
        }
        Ok(Value::Object(result))
    }
}
