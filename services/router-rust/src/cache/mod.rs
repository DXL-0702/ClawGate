use redis::{Client, AsyncCommands, aio::MultiplexedConnection};
use tokio::sync::Mutex;

pub struct L1Cache {
    conn: Mutex<MultiplexedConnection>,
    ttl: u64,
}

impl L1Cache {
    pub async fn new(redis_url: &str, ttl: u64) -> anyhow::Result<Self> {
        let client = Client::open(redis_url)?;
        let conn = client.get_multiplexed_async_connection().await?;
        // 验证连接可用
        let mut c = conn.clone();
        redis::cmd("PING").query_async::<String>(&mut c).await?;
        Ok(Self { conn: Mutex::new(conn), ttl })
    }

    async fn get_conn(&self) -> anyhow::Result<tokio::sync::MutexGuard<'_, MultiplexedConnection>> {
        Ok(self.conn.lock().await)
    }

    pub async fn get(&self, prompt: &str) -> anyhow::Result<Option<String>> {
        let key = format!("clawgate:l1:{}", hash_key(&normalise(prompt)));
        let mut conn = self.get_conn().await?;
        let val: Option<String> = conn.get(&key).await?;
        Ok(val)
    }

    pub async fn set(&self, prompt: &str, model: &str) -> anyhow::Result<()> {
        let key = format!("clawgate:l1:{}", hash_key(&normalise(prompt)));
        let mut conn = self.get_conn().await?;
        conn.set_ex::<_, _, ()>(&key, model, self.ttl).await?;
        Ok(())
    }
}

#[allow(dead_code)]
pub fn normalise(prompt: &str) -> String {
    prompt.trim().to_lowercase()
}

#[allow(dead_code)]
pub fn hash_key(input: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalise_trims_and_lowercases() {
        assert_eq!(normalise("  Hello World  "), "hello world");
        assert_eq!(normalise("RUST"), "rust");
    }

    #[test]
    fn test_hash_key_deterministic() {
        let h1 = hash_key("hello");
        let h2 = hash_key("hello");
        assert_eq!(h1, h2);
        assert_eq!(h1.len(), 64);
    }

    #[test]
    fn test_hash_key_different_inputs() {
        assert_ne!(hash_key("hello"), hash_key("world"));
    }
}
