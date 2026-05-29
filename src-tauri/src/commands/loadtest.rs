use reqwest::{Client, Method, header::{HeaderMap, HeaderName, HeaderValue}};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Instant;
use tokio::sync::Semaphore;
use tauri::Emitter;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadRequest {
    pub method: String,
    pub url: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub total: u32,
    pub concurrency: u32,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestProgress {
    pub completed: u32,
    pub errors: u32,
    pub total: u32,
    pub rps: f64,
    pub avg_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTestResult {
    pub total: u32,
    pub completed: u32,
    pub errors: u32,
    pub min_ms: u64,
    pub max_ms: u64,
    pub avg_ms: f64,
    pub p50_ms: u64,
    pub p95_ms: u64,
    pub p99_ms: u64,
    pub throughput: f64,
    pub error_rate: f64,
    pub duration_secs: f64,
    pub latencies: Vec<u64>,
}

#[tauri::command]
pub async fn run_load_test(
    window: tauri::Window,
    request: LoadRequest,
) -> Result<LoadTestResult, String> {
    let total = request.total.max(1);
    let concurrency = request.concurrency.max(1).min(total);

    let mut client_builder = Client::builder()
        .danger_accept_invalid_certs(false);
    if let Some(ms) = request.timeout_ms {
        client_builder = client_builder.timeout(std::time::Duration::from_millis(ms));
    }
    let client = Arc::new(client_builder.build().map_err(|e| e.to_string())?);

    let mut header_map = HeaderMap::new();
    for (k, v) in &request.headers {
        if let (Ok(name), Ok(val)) = (HeaderName::from_str(k), HeaderValue::from_str(v)) {
            header_map.insert(name, val);
        }
    }

    let method = Arc::new(Method::from_str(&request.method).map_err(|e| e.to_string())?);
    let url = Arc::new(request.url.clone());
    let body = Arc::new(request.body.unwrap_or_default());
    let headers = Arc::new(header_map);
    let semaphore = Arc::new(Semaphore::new(concurrency as usize));

    let latencies: Arc<tokio::sync::Mutex<Vec<u64>>> = Arc::new(tokio::sync::Mutex::new(Vec::with_capacity(total as usize)));
    let error_count = Arc::new(AtomicU32::new(0));
    let done_count = Arc::new(AtomicU32::new(0));
    let global_start = Instant::now();

    let mut handles = Vec::with_capacity(total as usize);

    for _ in 0..total {
        let sem = semaphore.clone();
        let client = client.clone();
        let method = method.clone();
        let url = url.clone();
        let body = body.clone();
        let headers = headers.clone();
        let latencies = latencies.clone();
        let error_count = error_count.clone();
        let done_count = done_count.clone();
        let window = window.clone();
        let gs = global_start;

        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await;

            let req_start = Instant::now();
            let mut req = client
                .request((*method).clone(), url.as_str())
                .headers((*headers).clone());
            if !body.is_empty() {
                req = req.body(body.as_str().to_owned());
            }

            let ok = req.send().await.is_ok();
            let elapsed = req_start.elapsed().as_millis() as u64;

            if ok {
                latencies.lock().await.push(elapsed);
            } else {
                error_count.fetch_add(1, Ordering::Relaxed);
            }

            let done = done_count.fetch_add(1, Ordering::Relaxed) + 1;
            let errors = error_count.load(Ordering::Relaxed);
            let elapsed_secs = gs.elapsed().as_secs_f64().max(0.001);

            if done % (total / 20).max(1) == 0 || done == total {
                let lats = latencies.lock().await;
                let avg_ms = if lats.is_empty() { 0.0 } else {
                    lats.iter().sum::<u64>() as f64 / lats.len() as f64
                };
                let _ = window.emit("load-test-progress", LoadTestProgress {
                    completed: done,
                    errors,
                    total,
                    rps: done as f64 / elapsed_secs,
                    avg_ms,
                });
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let duration_secs = global_start.elapsed().as_secs_f64();
    let completed = done_count.load(Ordering::Relaxed);
    let errors = error_count.load(Ordering::Relaxed);
    let mut lats = latencies.lock().await.clone();
    lats.sort_unstable();

    let n = lats.len();
    let min_ms = lats.first().copied().unwrap_or(0);
    let max_ms = lats.last().copied().unwrap_or(0);
    let avg_ms = if n > 0 { lats.iter().sum::<u64>() as f64 / n as f64 } else { 0.0 };
    // Nearest-rank percentile: index = ceil(p/100 * n) - 1, clamped to [0, n-1]
    let pct = |p: usize| -> u64 {
        if n == 0 { return 0; }
        let idx = ((n * p + 99) / 100).saturating_sub(1).min(n - 1);
        lats[idx]
    };
    let p50_ms = pct(50);
    let p95_ms = pct(95);
    let p99_ms = pct(99);
    let throughput = completed as f64 / duration_secs.max(0.001);
    let error_rate = errors as f64 / total as f64 * 100.0;

    Ok(LoadTestResult {
        total,
        completed,
        errors,
        min_ms,
        max_ms,
        avg_ms,
        p50_ms,
        p95_ms,
        p99_ms,
        throughput,
        error_rate,
        duration_secs,
        latencies: lats,
    })
}
