//! Verify that a published article is reachable on the public site.

use std::io::Read;
use std::time::Duration;

/// Result of verifying a public article URL.
#[derive(Debug, Clone, PartialEq)]
pub enum VerifyOutcome {
    /// HTTP 200 and body contains the expected title.
    Reachable,
    /// HTTP returned an error status or body did not match.
    NotFound(String),
    /// Network / TLS failure (possibly a transient cache delay).
    Unreachable(String),
}

/// Fetch the article page and check it contains the expected title.
pub fn verify_public_article(url: &str, expected_title: &str) -> VerifyOutcome {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(12))
        .build();

    let response = match agent.get(url).call() {
        Ok(res) => res,
        Err(ureq::Error::Status(code, _)) => {
            return VerifyOutcome::NotFound(format!("HTTP {}（可能尚未部署或 404）", code));
        }
        Err(e) => {
            return VerifyOutcome::Unreachable(format!("网络请求失败：{}", e));
        }
    };

    let status = response.status();
    let mut reader = response.into_reader();
    let mut bytes = Vec::new();
    let mut buf = [0u8; 4096];
    while bytes.len() < 1024 * 1024 {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => bytes.extend_from_slice(&buf[..n]),
            Err(e) => return VerifyOutcome::Unreachable(format!("读取页面失败：{}", e)),
        }
    }
    let body = String::from_utf8_lossy(&bytes).to_string();

    if status != 200 {
        return VerifyOutcome::NotFound(format!("HTTP {}（GitHub Pages 可能返回 404）", status));
    }

    // GitHub Pages 404 page is short and generic; a real article contains the title.
    let normalized_title = expected_title.trim();
    let looks_like_gh_404 =
        body.contains("404") && !body.contains(normalized_title) && body.len() < 2000;

    if body.contains(normalized_title) && !looks_like_gh_404 {
        VerifyOutcome::Reachable
    } else if looks_like_gh_404 {
        VerifyOutcome::NotFound("页面内容不匹配，可能是 GitHub Pages 404 页面。".to_string())
    } else {
        VerifyOutcome::NotFound("页面可访问但未找到文章标题，可能仍在部署。".to_string())
    }
}

/// Retry verification up to `max_attempts` times with `interval_seconds` between.
pub fn verify_with_retry(
    url: &str,
    expected_title: &str,
    max_attempts: u32,
    interval_seconds: u64,
) -> VerifyOutcome {
    let mut last = verify_public_article(url, expected_title);
    let mut attempt = 1;
    while last != VerifyOutcome::Reachable && attempt < max_attempts {
        std::thread::sleep(Duration::from_secs(interval_seconds));
        last = verify_public_article(url, expected_title);
        attempt += 1;
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;

    /// Serve a tiny HTTP response on a local port for testing.
    /// The listener is owned by the spawned thread and answers one request.
    fn serve(status: u16, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let body = body.to_string();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                let reason = if status == 200 { "OK" } else { "Not Found" };
                let resp = format!(
                    "HTTP/1.1 {} {}\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    reason,
                    body.len(),
                    body
                );
                let _ = write!(stream, "{}", resp);
            }
        });
        format!("http://{}", addr)
    }

    #[test]
    fn verifies_reachable_article() {
        let url = serve(200, "<html><title>Agent 评测与生产治理笔记</title><body>Agent 评测与生产治理笔记 正文</body></html>");
        let outcome = verify_public_article(&url, "Agent 评测与生产治理笔记");
        assert_eq!(outcome, VerifyOutcome::Reachable);
    }

    #[test]
    fn detects_404() {
        let url = serve(404, "<html>404 Not Found</html>");
        let outcome = verify_public_article(&url, "测试文章");
        assert!(matches!(outcome, VerifyOutcome::NotFound(_)));
    }

    #[test]
    fn detects_missing_title() {
        let url = serve(200, "<html><body>something else entirely</body></html>");
        let outcome = verify_public_article(&url, "不存在的文章标题");
        assert!(matches!(outcome, VerifyOutcome::NotFound(_)));
    }
}
