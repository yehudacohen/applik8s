#[tokio::main]
async fn main() {
    if let Err(error) = applik8s_operator_host::run_from_env().await {
        eprintln!("applik8s operator host failed: {error}");
        std::process::exit(1);
    }
}
