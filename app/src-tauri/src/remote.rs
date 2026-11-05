//! Opening files on another machine over SSH (desktop app only).
//!
//! Everything goes through the system `ssh` program, so the user's own
//! keys, agent, ~/.ssh/config, ProxyJump, Kerberos etc. just work.
//! Version 1 supports key-based login only: ssh runs with BatchMode=yes
//! and never asks for a password.
//!
//! Security rules (keep these when changing this file):
//!  - The command run on the remote machine is always one of the fixed
//!    scripts below. Paths never go into the command line: they are
//!    written to ssh's stdin and read there with `read`, so they are only
//!    ever data, whatever characters they contain.
//!  - `--` goes before the host, and hosts starting with '-' are rejected,
//!    so a "host" can never be taken as an ssh option.
//!  - The remote side only lists folders and reads files. Nothing is
//!    written, deleted or run there.
//!  - Locally, only ~/.ssh/config is read, and only its Host names are
//!    passed to the page. Keys and known_hosts are never touched.
//!
//! All ssh calls go through `run_ssh`. Password/2FA support (later) only
//! needs to change that one function.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

// ── Remote scripts ──────────────────────────────────────────────────────
//
// Run as `sh -c '<script>'`, so they work whatever the user's login shell
// is (bash, tcsh, …). They must stay on one line and contain no single
// quotes and no '!' (tcsh treats '!' specially even inside quotes).
//
// Each prints a marker line before its real output, so text printed by
// the user's .bashrc or similar is skipped instead of corrupting the data.

const LIST_MARKER: &[u8] = b"RLV-LIST\n";
const DATA_MARKER: &[u8] = b"RLV-DATA\n";

/// stdin: a folder (empty = home). stdout: marker, the folder's full path,
/// then one line per entry: type <tab> size <tab> name, where type is
/// d (folder) or f (file). Uses GNU find; falls back to ls (no sizes).
const LIST_SCRIPT: &str = concat!(
    r#"IFS= read -r d; [ -n "$d" ] || d=$HOME; cd -- "$d" || exit 3; "#,
    r#"printf "RLV-LIST\n"; pwd; "#,
    r#"if find . -maxdepth 0 -printf "" >/dev/null 2>&1; then "#,
    r#"find -L . -mindepth 1 -maxdepth 1 -printf "%y\t%s\t%P\n" 2>/dev/null; "#,
    r#"else ls -1ApL | while IFS= read -r n; do case "$n" in "#,
    r#"*/) printf "d\t-\t%s\n" "${n%/}";; *) printf "f\t-\t%s\n" "$n";; "#,
    r#"esac; done; fi"#,
);

/// stdin: a file path. stdout: marker, then the file's bytes.
const READ_SCRIPT: &str = concat!(
    r#"IFS= read -r p; "#,
    r#"[ -f "$p" ] || { echo "Not a file: $p" >&2; exit 3; }; "#,
    r#"[ -r "$p" ] || { echo "Cannot read: $p" >&2; exit 3; }; "#,
    r#"printf "RLV-DATA\n"; exec cat -- "$p""#,
);

// ── Errors ──────────────────────────────────────────────────────────────

/// What went wrong, so the page can show a useful message.
#[derive(Debug)]
pub enum SshError {
    NoSsh,
    BadInput(String),
    AuthFailed(String),
    HostKey(String),
    Unreachable(String, String),
    Remote(String),
    Other(String),
}

/// The error as the page receives it: `{ kind, message }`.
#[derive(serde::Serialize)]
pub struct ErrorInfo {
    kind: &'static str,
    message: String,
}

impl From<SshError> for ErrorInfo {
    fn from(e: SshError) -> Self {
        use SshError::*;
        let (kind, message) = match e {
            NoSsh => ("no-ssh", "The ssh program was not found. Install OpenSSH \
                (it comes with Linux, macOS and Windows 10 or later).".to_string()),
            BadInput(m) => ("bad-input", m),
            AuthFailed(h) => ("auth", format!(
                "Could not log in to {h} with an SSH key. RLV does not support \
                 passwords yet: set up key login (for example `ssh-copy-id {h}` \
                 in a terminal) and try again.")),
            HostKey(h) => ("host-key", format!(
                "{h} is not in your known hosts, or its key has changed. Connect \
                 once in a terminal with `ssh {h}` and check the key, then try again.")),
            Unreachable(h, m) => ("unreachable", format!("Could not reach {h}: {m}")),
            Remote(m) => ("remote", m),
            Other(m) => ("other", m),
        };
        ErrorInfo { kind, message }
    }
}

fn classify(host: &str, code: Option<i32>, stderr: &str) -> SshError {
    let last = stderr
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .last()
        .unwrap_or("")
        .to_string();
    // ssh exits with 255 for its own errors, otherwise with the remote
    // command's exit code.
    if code == Some(255) {
        if stderr.contains("Host key verification failed")
            || stderr.contains("IDENTIFICATION HAS CHANGED")
        {
            SshError::HostKey(host.to_string())
        } else if stderr.contains("Permission denied")
            || stderr.contains("Too many authentication failures")
        {
            SshError::AuthFailed(host.to_string())
        } else {
            let m = if last.is_empty() { "connection failed".to_string() } else { last };
            SshError::Unreachable(host.to_string(), m)
        }
    } else if last.is_empty() {
        SshError::Remote(format!("The remote command failed (exit code {code:?})."))
    } else {
        SshError::Remote(last)
    }
}

// ── Running ssh ─────────────────────────────────────────────────────────

fn check_host(host: &str) -> Result<(), SshError> {
    if host.is_empty()
        || host.starts_with('-')
        || host.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(SshError::BadInput(format!("Not a valid host: {host:?}")));
    }
    Ok(())
}

fn check_path(path: &str) -> Result<(), SshError> {
    if path.contains('\n') || path.contains('\0') {
        return Err(SshError::BadInput("Paths with line breaks are not supported.".into()));
    }
    Ok(())
}

/// Run one of the fixed scripts on `host`, with `input` on its stdin.
/// Returns its stdout. The only place that starts ssh.
fn run_ssh(host: &str, script: &str, input: &str) -> Result<Vec<u8>, SshError> {
    check_host(host)?;
    check_path(input)?;

    let mut cmd = Command::new("ssh");
    cmd.args([
        "-o", "BatchMode=yes",         // never prompt (key login only, for now)
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=4",
        "--", host,
    ])
    .arg(format!("sh -c '{script}'"))
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

    // Don't flash a console window on Windows.
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => SshError::NoSsh,
        _ => SshError::Other(format!("Could not start ssh: {e}")),
    })?;

    // Send the path, then close stdin (the block ends) so `read` gets it.
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(input.as_bytes());
        let _ = stdin.write_all(b"\n");
    }

    let out = child
        .wait_with_output()
        .map_err(|e| SshError::Other(format!("ssh failed: {e}")))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(classify(host, out.status.code(), &String::from_utf8_lossy(&out.stderr)))
    }
}

/// Everything after the first `marker` (skips any login-script output).
fn after_marker(data: Vec<u8>, marker: &[u8]) -> Result<Vec<u8>, SshError> {
    match data.windows(marker.len()).position(|w| w == marker) {
        Some(i) => Ok(data[i + marker.len()..].to_vec()),
        None => Err(SshError::Remote("Unexpected reply from the remote machine.".into())),
    }
}

// ── Listing ─────────────────────────────────────────────────────────────

#[derive(serde::Serialize, Debug, PartialEq)]
pub struct Entry {
    name: String,
    is_dir: bool,
    size: Option<u64>,
}

#[derive(serde::Serialize, Debug)]
pub struct Listing {
    dir: String,
    entries: Vec<Entry>,
}

fn parse_listing(out: &[u8]) -> Listing {
    let text = String::from_utf8_lossy(out);
    let mut lines = text.lines();
    let dir = lines.next().unwrap_or("/").to_string();
    let entries = lines
        .filter_map(|line| {
            let mut parts = line.splitn(3, '\t');
            let kind = parts.next()?;
            let size = parts.next()?;
            let name = parts.next()?;
            if name.is_empty() {
                return None;
            }
            Some(Entry {
                name: name.to_string(),
                is_dir: kind == "d",
                size: size.parse().ok(),
            })
        })
        .collect();
    Listing { dir, entries }
}

// ── ~/.ssh/config ───────────────────────────────────────────────────────

fn home_dir() -> Option<PathBuf> {
    let var = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
    std::env::var_os(var).map(PathBuf::from)
}

/// Host aliases from the text of an ssh config file, without patterns
/// (`Host *`, `Host *.example.org`). `Include` files are not followed.
fn hosts_from_config(text: &str) -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        // "Host a b" or "Host=a b"; the keyword is case-insensitive.
        let Some((key, rest)) = line.split_once(|c: char| c.is_whitespace() || c == '=') else {
            continue;
        };
        if !key.eq_ignore_ascii_case("host") {
            continue;
        }
        let rest = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=');
        for name in rest.split_whitespace() {
            let name = name.trim_matches('"');
            if name.is_empty() || name.contains(['*', '?', '!']) || name.starts_with('#') {
                continue;
            }
            if !hosts.iter().any(|h| h == name) {
                hosts.push(name.to_string());
            }
        }
    }
    hosts
}

// ── Commands for the page ───────────────────────────────────────────────

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, SshError> + Send + 'static,
) -> Result<T, ErrorInfo> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| ErrorInfo::from(SshError::Other(e.to_string())))?
        .map_err(ErrorInfo::from)
}

/// Host names from ~/.ssh/config, for the host dropdown.
#[tauri::command]
pub fn remote_hosts() -> Vec<String> {
    home_dir()
        .and_then(|h| std::fs::read_to_string(h.join(".ssh").join("config")).ok())
        .map(|text| hosts_from_config(&text))
        .unwrap_or_default()
}

/// List a folder on `host` (empty `dir` = the remote home folder).
#[tauri::command]
pub async fn remote_list(host: String, dir: String) -> Result<Listing, ErrorInfo> {
    blocking(move || {
        let out = run_ssh(&host, LIST_SCRIPT, &dir)?;
        Ok(parse_listing(&after_marker(out, LIST_MARKER)?))
    })
    .await
}

/// Read a file on `host`; arrives in JavaScript as an ArrayBuffer.
#[tauri::command]
pub async fn remote_read(host: String, path: String) -> Result<tauri::ipc::Response, ErrorInfo> {
    blocking(move || {
        if path.is_empty() {
            return Err(SshError::BadInput("No file given.".into()));
        }
        let out = run_ssh(&host, READ_SCRIPT, &path)?;
        after_marker(out, DATA_MARKER)
    })
    .await
    .map(tauri::ipc::Response::new)
}

// ── Tests (cargo test) ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_hosts() {
        let text = "Host cluster login01\n  User me\nHost *\n  ServerAliveInterval 30\n\
                    host=diamond\nHost *.ac.uk\nMatch all\nHost cluster\n";
        assert_eq!(hosts_from_config(text), ["cluster", "login01", "diamond"]);
    }

    #[test]
    fn listing() {
        let l = parse_listing(b"/home/me\nd\t4096\tproc\nf\t123\tindexed.refl\nf\t-\ta b.expt\n");
        assert_eq!(l.dir, "/home/me");
        assert_eq!(l.entries.len(), 3);
        assert!(l.entries[0].is_dir);
        assert_eq!(l.entries[1].size, Some(123));
        assert_eq!(l.entries[2], Entry { name: "a b.expt".into(), is_dir: false, size: None });
    }

    #[test]
    fn marker_skips_login_noise() {
        let data = b"Welcome to the cluster!\nRLV-DATA\n\x00\x01binary".to_vec();
        assert_eq!(after_marker(data, DATA_MARKER).unwrap(), b"\x00\x01binary");
    }

    #[test]
    fn bad_hosts() {
        assert!(check_host("-oProxyCommand=touch /tmp/x").is_err());
        assert!(check_host("my host").is_err());
        assert!(check_host("").is_err());
        assert!(check_host("me@login01.example.ac.uk").is_ok());
    }

    #[test]
    fn scripts_are_safe_to_quote() {
        for s in [LIST_SCRIPT, READ_SCRIPT] {
            assert!(!s.contains('\'') && !s.contains('!') && !s.contains('\n'));
        }
    }

    #[test]
    fn errors() {
        assert!(matches!(classify("c", Some(255), "me@c: Permission denied (publickey).\n"),
                         SshError::AuthFailed(_)));
        assert!(matches!(classify("c", Some(255), "Host key verification failed.\n"),
                         SshError::HostKey(_)));
        assert!(matches!(classify("c", Some(255), "ssh: Could not resolve hostname c\n"),
                         SshError::Unreachable(..)));
        assert!(matches!(classify("c", Some(3), "Not a file: /x\n"), SshError::Remote(_)));
    }
}
