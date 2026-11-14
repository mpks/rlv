// Sets RLV_VERSION for the app (shown by `rlv --version`), from the
// RLV_VERSION environment variable if set (the release workflow sets it to
// the tag), otherwise from git: "v0.1.6", "v0.1.6-3-gabc1234" three commits
// later, "-dirty" with uncommitted changes. The web page gets the same
// version from vite.config.js.

use std::process::Command;

fn main() {
    let version = std::env::var("RLV_VERSION")
        .ok()
        .filter(|v| !v.is_empty())
        .or_else(|| {
            Command::new("git")
                .args(["describe", "--tags", "--always", "--dirty"])
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        })
        .unwrap_or_else(|| format!("v{}", std::env::var("CARGO_PKG_VERSION").unwrap()));
    println!("cargo:rustc-env=RLV_VERSION={version}");

    // Work the version out again after a commit or a new tag.
    println!("cargo:rerun-if-env-changed=RLV_VERSION");
    for f in ["HEAD", "packed-refs", "refs/tags"] {
        println!("cargo:rerun-if-changed=../../.git/{f}");
    }

    tauri_build::build()
}
