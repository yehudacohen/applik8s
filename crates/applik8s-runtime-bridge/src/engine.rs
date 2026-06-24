use kube::Client;
use std::time::Duration;
use wasmtime::{Config, Engine};

use crate::error::RuntimeBridgeError;

#[derive(Clone)]
pub struct KubeRuntimeBridge {
    client: Client,
    engine: Engine,
}

impl KubeRuntimeBridge {
    pub fn new(client: Client, engine: Engine) -> Self {
        Self { client, engine }
    }

    pub fn client(&self) -> &Client {
        &self.client
    }

    pub fn engine(&self) -> &Engine {
        &self.engine
    }
}

pub fn component_model_engine() -> Result<Engine, RuntimeBridgeError> {
    let mut config = Config::new();
    config.wasm_component_model(true);
    config.epoch_interruption(true);

    let engine = Engine::new(&config)?;
    start_epoch_ticker(engine.clone());
    Ok(engine)
}

fn start_epoch_ticker(engine: Engine) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(10));
            engine.increment_epoch();
        }
    });
}
