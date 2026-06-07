use std::{net::SocketAddr, sync::Arc};

use axum::{
    extract::State,
    http::{HeaderValue, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::printer;
use crate::state::{AppState, PrinterConfig, PrinterStatus};

pub const BRIDGE_PORT: u16 = 9177;

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    version: &'static str,
    printers: Vec<PrinterStatus>,
}

#[derive(Serialize)]
struct ConfigPrinter {
    role: String,
    name: String,
    #[serde(rename = "vendorId")]
    vendor_id: u16,
    #[serde(rename = "productId")]
    product_id: u16,
}

#[derive(Serialize)]
struct ConfigResponse {
    ok: bool,
    printers: Vec<ConfigPrinter>,
}

#[derive(Deserialize)]
struct ConfigPutRequest {
    printers: Vec<ConfigPutPrinter>,
}

#[derive(Deserialize)]
struct ConfigPutPrinter {
    role: String,
    name: String,
    #[serde(rename = "vendorId")]
    vendor_id: u16,
    #[serde(rename = "productId")]
    product_id: u16,
}

#[derive(Deserialize)]
struct PrintRequest {
    role: String,
    format: String,
    data: String,
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(rename = "previewHtml", default)]
    preview_html: Option<String>,
}

#[derive(Serialize)]
struct PrintResponse {
    ok: bool,
    #[serde(rename = "jobId")]
    job_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mocked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

pub async fn run(state: Arc<AppState>) -> anyhow::Result<()> {
    // CORS allowlist:
    //   - production dashboard at https://dashboard.sufra.app
    //   - bridge's own Tauri webview (http(s)://tauri.localhost)
    //   - ANY loopback origin (localhost / 127.0.0.1 on any port, http or https)
    //
    // Allowing any loopback origin is safe: the bridge listens only on
    // 127.0.0.1 so only the local machine can reach it. We can't usefully
    // distinguish "the dashboard tab" from "another loopback page" at the
    // CORS layer anyway — anyone with local access has bigger trust
    // problems than a fake receipt.
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::predicate(|origin: &HeaderValue, _parts: &http::request::Parts| -> bool {
            let Ok(s) = origin.to_str() else { return false };
            if s == "https://dashboard.sufra.app" { return true }
            if s == "http://tauri.localhost" || s == "https://tauri.localhost" { return true }
            s.starts_with("http://localhost:")
                || s.starts_with("https://localhost:")
                || s.starts_with("http://127.0.0.1:")
                || s.starts_with("https://127.0.0.1:")
        }))
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([axum::http::header::CONTENT_TYPE])
        .max_age(std::time::Duration::from_secs(600));

    let app = Router::new()
        .route("/health", get(health))
        .route("/devices", get(devices))
        .route("/config", get(get_config).put(put_config))
        .route("/jobs", get(jobs))
        .route("/print", post(print))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], BRIDGE_PORT));
    tracing::info!("bridge listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(HealthResponse {
        ok: true,
        version: env!("CARGO_PKG_VERSION"),
        printers: state.printer_statuses(),
    })
}

async fn get_config(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let printers = state
        .printers()
        .into_iter()
        .map(|p| ConfigPrinter {
            role: p.role,
            name: p.name,
            vendor_id: p.vendor_id,
            product_id: p.product_id,
        })
        .collect();
    Json(ConfigResponse { ok: true, printers })
}

async fn put_config(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ConfigPutRequest>,
) -> impl IntoResponse {
    let new_printers: Vec<PrinterConfig> = req
        .printers
        .into_iter()
        .map(|p| PrinterConfig {
            role: p.role,
            name: p.name,
            vendor_id: p.vendor_id,
            product_id: p.product_id,
        })
        .collect();

    for p in &new_printers {
        if p.role != "pos" && p.role != "kitchen" {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "code": "invalid_role",
                    "message": format!("role must be 'pos' or 'kitchen', got '{}'", p.role)
                })),
            );
        }
    }

    match state.replace_printers(new_printers) {
        Ok(_) => (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "ok": false,
                "code": "save_failed",
                "message": e.to_string(),
            })),
        ),
    }
}

async fn jobs(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    Json(serde_json::json!({
        "ok": true,
        "jobs": state.recent_jobs(),
    }))
}

async fn devices() -> impl IntoResponse {
    let result = tokio::task::spawn_blocking(printer::list_printers).await;
    match result {
        Ok(Ok(printers)) => (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "devices": printers })),
        ),
        Ok(Err(e)) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "ok": false,
                "code": "enumerate_failed",
                "message": e.to_string(),
            })),
        ),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "ok": false,
                "code": "task_panic",
                "message": e.to_string(),
            })),
        ),
    }
}

async fn print(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PrintRequest>,
) -> (StatusCode, Json<PrintResponse>) {
    if req.format != "escpos" {
        return (
            StatusCode::BAD_REQUEST,
            Json(PrintResponse {
                ok: false,
                job_id: req.job_id,
                mocked: None,
                code: Some("unsupported_format"),
                message: Some(format!("unsupported format: {}", req.format)),
            }),
        );
    }

    let bytes = match STANDARD.decode(&req.data) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(PrintResponse {
                    ok: false,
                    job_id: req.job_id,
                    mocked: None,
                    code: Some("invalid_base64"),
                    message: Some(e.to_string()),
                }),
            );
        }
    };

    tracing::info!(
        job_id = %req.job_id,
        role = %req.role,
        bytes = bytes.len(),
        "print job received"
    );

    match state
        .dispatch_print(
            req.job_id.clone(),
            req.role.clone(),
            bytes,
            req.preview_html.clone(),
        )
        .await
    {
        Ok(job) => (
            StatusCode::OK,
            Json(PrintResponse {
                ok: true,
                job_id: req.job_id,
                mocked: Some(job.mocked),
                code: None,
                message: None,
            }),
        ),
        Err(job) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(PrintResponse {
                ok: false,
                job_id: req.job_id,
                mocked: Some(false),
                code: Some("print_failed"),
                message: job.error,
            }),
        ),
    }
}
