//! Port de `src/lib/jsonpath.ts`, que respalda el extractor de variables.
//!
//! El usuario escribe reglas `$.data.token -> {{token}}` y la cadena capturada
//! se escribe tal cual en el entorno, asi que "devuelve None" y "devuelve la
//! cadena \"null\"" son resultados muy distintos. Los tests de
//! `src/lib/__tests__/jsonpath.test.ts` estan replicados aqui uno a uno: si los
//! dos se separan, un extractor captura una cosa en la app y otra en CI.

use serde_json::Value;

/// Igual que `formatLeaf`: `null` no es un valor capturable, un objeto se
/// serializa y cualquier otro escalar se convierte a texto.
fn format_leaf(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        Value::Bool(b) => Some(b.to_string()),
        Value::Number(n) => {
            // JS no distingue enteros de flotantes: `String(1.0)` es "1". Sin
            // esto, un `1.0` en el JSON daria "1" en la app y "1.0" aqui.
            if let Some(f) = n.as_f64() {
                if n.as_i64().is_none() && n.as_u64().is_none() && f.fract() == 0.0 {
                    return Some(format!("{}", f as i64));
                }
            }
            Some(n.to_string())
        }
        other => Some(serde_json::to_string(other).unwrap_or_default()),
    }
}

fn walk(segments: &[&str], data: &Value) -> Option<String> {
    let mut current = data;

    for (i, seg) in segments.iter().enumerate() {
        if current.is_null() {
            return None;
        }

        if *seg == "*" {
            let items = current.as_array()?;
            // El resto de la ruta se proyecta sobre cada elemento:
            // `[*].id` -> "1, 2". Un elemento que no la cumple deja hueco.
            let rest = &segments[i + 1..];
            let joined = items
                .iter()
                .map(|item| {
                    if rest.is_empty() {
                        format_leaf(item)
                    } else {
                        walk(rest, item)
                    }
                    .unwrap_or_default()
                })
                .collect::<Vec<_>>()
                .join(", ");
            return Some(joined);
        }

        // Un segmento numerico indexa solo si lo que hay es un array.
        current = match (seg.parse::<usize>(), current) {
            (Ok(idx), Value::Array(items)) => items.get(idx)?,
            (_, Value::Object(map)) => map.get(*seg)?,
            _ => return None,
        };
    }

    format_leaf(current)
}

/// Evalua una ruta tipo `$.data.items[0].id` sobre un JSON ya parseado.
pub fn evaluate_path(path: &str, data: &Value) -> Option<String> {
    if !path.starts_with('$') {
        return None;
    }

    // tokeniza: $.a.b[0].c[*] -> ["a", "b", "0", "c", "*"]
    let segments: Vec<&str> = path[1..]
        .split(['.', '[', ']'])
        .filter(|s| !s.is_empty())
        .collect();

    walk(&segments, data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn data() -> Value {
        json!({
            "data": {
                "token": "abc123",
                "count": 42,
                "active": true,
                "nested": { "deep": { "value": "found" } },
                "items": [{ "id": 1, "name": "first" }, { "id": 2, "name": "second" }],
                "empty": null
            }
        })
    }

    fn at(path: &str) -> Option<String> {
        evaluate_path(path, &data())
    }

    #[test]
    fn reads_a_top_level_property() {
        assert_eq!(evaluate_path("$.data", &json!({"data": "x"})).as_deref(), Some("x"));
    }

    #[test]
    fn reads_a_nested_property() {
        assert_eq!(at("$.data.token").as_deref(), Some("abc123"));
    }

    #[test]
    fn walks_arbitrarily_deep() {
        assert_eq!(at("$.data.nested.deep.value").as_deref(), Some("found"));
    }

    #[test]
    fn stringifies_non_string_scalars() {
        assert_eq!(at("$.data.count").as_deref(), Some("42"));
        assert_eq!(at("$.data.active").as_deref(), Some("true"));
    }

    #[test]
    fn indexes_into_arrays() {
        assert_eq!(at("$.data.items[0].name").as_deref(), Some("first"));
        assert_eq!(at("$.data.items[1].id").as_deref(), Some("2"));
    }

    #[test]
    fn joins_a_bare_wildcard_over_an_array() {
        assert_eq!(
            at("$.data.items[*]").as_deref(),
            Some(r#"{"id":1,"name":"first"}, {"id":2,"name":"second"}"#)
        );
    }

    #[test]
    fn projects_the_rest_of_the_path_over_a_wildcard() {
        assert_eq!(at("$.data.items[*].id").as_deref(), Some("1, 2"));
        assert_eq!(at("$.data.items[*].name").as_deref(), Some("first, second"));
    }

    #[test]
    fn leaves_an_empty_entry_where_a_wildcard_projection_misses() {
        let mixed = json!({ "items": [{ "id": 1 }, { "other": 2 }, { "id": 3 }] });
        assert_eq!(evaluate_path("$.items[*].id", &mixed).as_deref(), Some("1, , 3"));
    }

    #[test]
    fn returns_none_when_a_wildcard_lands_on_a_non_array() {
        assert_eq!(at("$.data.token[*]"), None);
    }

    #[test]
    fn serializes_an_object_leaf_as_json() {
        assert_eq!(at("$.data.nested.deep").as_deref(), Some(r#"{"value":"found"}"#));
    }

    #[test]
    fn returns_none_for_a_missing_path() {
        assert_eq!(at("$.data.nope"), None);
        assert_eq!(at("$.data.nested.missing.deeper"), None);
    }

    #[test]
    fn returns_none_for_a_null_leaf() {
        assert_eq!(at("$.data.empty"), None);
    }

    #[test]
    fn returns_none_for_an_out_of_range_index() {
        assert_eq!(at("$.data.items[9].name"), None);
    }

    #[test]
    fn rejects_paths_that_do_not_start_with_dollar() {
        assert_eq!(at("data.token"), None);
        assert_eq!(at(""), None);
    }

    #[test]
    fn returns_none_when_descending_into_a_scalar() {
        assert_eq!(at("$.data.token.further"), None);
    }

    #[test]
    fn handles_a_null_root() {
        assert_eq!(evaluate_path("$.a", &Value::Null), None);
    }

    /// `String(1.0)` en JS es "1", no "1.0".
    #[test]
    fn a_float_with_no_fraction_reads_like_an_integer() {
        let v = json!({ "n": 1.0 });
        assert_eq!(evaluate_path("$.n", &v).as_deref(), Some("1"));
    }

    #[test]
    fn a_real_float_keeps_its_fraction() {
        let v = json!({ "n": 1.5 });
        assert_eq!(evaluate_path("$.n", &v).as_deref(), Some("1.5"));
    }
}
