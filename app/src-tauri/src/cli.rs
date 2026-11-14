// Command line: `rlv [FILE.expt FILE.refl ...]`, like
// `dials.reciprocal_lattice_viewer imported.expt strong.refl`, plus
// `rlv --help` and `rlv --version`.
//
// Parsed before the window opens: --help, --version and mistakes (missing
// file, unknown option) print to the terminal and exit without a window.
// The files are checked here and handed to the page (desktop.js) through
// the `startup_files` command, which loads them as if opened with Open.

use std::path::{Path, PathBuf};

/// Version from the git tag, set by build.rs ("v0.1.6", or
/// "v0.1.6-3-gabc1234" for a build three commits after the tag).
pub const VERSION: &str = env!("RLV_VERSION");

const USAGE: &str = "\
Usage:
  rlv [FILE.expt FILE.refl ...]

Opens DIALS experiment (.expt) and reflection (.refl) files, as in
  dials.reciprocal_lattice_viewer imported.expt strong.refl

  rlv imported.expt strong.refl   one experiment with its reflections
  rlv indexed.expt                also opens indexed.refl next to it
  rlv a.expt a.refl b.expt b.refl several pairs, shown together

Options:
  -h, --help       show this help and exit
  -V, --version    show the version and exit

Settings such as show_rotation_axis=True (as for dials.rlv) are ignored;
use the switches in the sidebar instead.";

/// (expt, refl) pairs of absolute paths to open at start, in order.
pub struct StartupFiles(pub Vec<(String, String)>);

/// Read the command line. Prints and exits for --help, --version and
/// errors; otherwise returns the files to open (possibly none).
pub fn parse() -> StartupFiles {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match parse_args(&args, &base_dir()) {
        Ok(Parsed::Files(pairs)) => StartupFiles(pairs),
        Ok(Parsed::Help) => {
            attach_console();
            println!("RLV {VERSION} - Reciprocal Lattice Viewer\n\n{USAGE}");
            std::process::exit(0);
        }
        Ok(Parsed::Version) => {
            attach_console();
            println!("rlv {VERSION}");
            std::process::exit(0);
        }
        Err(msg) => {
            attach_console();
            eprintln!("rlv: {msg}\nTry 'rlv --help' for more information.");
            std::process::exit(2);
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum Parsed {
    Help,
    Version,
    Files(Vec<(String, String)>),
}

/// The command-line rules, separate from printing and exiting so they can
/// be tested. `base` is the folder relative paths are taken from.
pub fn parse_args(args: &[String], base: &Path) -> Result<Parsed, String> {
    let mut expts: Vec<PathBuf> = Vec::new();
    let mut refls: Vec<PathBuf> = Vec::new();

    for arg in args {
        match arg.as_str() {
            "-h" | "--help" | "-help" => return Ok(Parsed::Help),
            "-V" | "-v" | "--version" => return Ok(Parsed::Version),
            _ => {}
        }
        // Added by macOS to apps started from Finder on old systems.
        if arg.starts_with("-psn_") {
            continue;
        }
        if arg.starts_with('-') {
            return Err(format!("unknown option '{arg}'"));
        }
        // dials-style settings (show_rotation_axis=True): not used here.
        if arg.contains('=') && !Path::new(arg).exists() {
            eprintln!("rlv: ignoring setting '{arg}'");
            continue;
        }
        let path = base.join(arg);
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        match ext.as_deref() {
            Some("expt") => expts.push(path.clone()),
            Some("refl") => refls.push(path.clone()),
            _ => return Err(format!("'{arg}' is not a .expt or .refl file")),
        }
        if !path.is_file() {
            return Err(format!("no such file: {arg}"));
        }
    }

    let mut pairs = Vec::new();
    if expts.is_empty() {
        // Only .refl files: each needs a .expt of the same name.
        for r in &refls {
            pairs.push((partner(r, "expt")?, r.clone()));
        }
    } else {
        if refls.len() > expts.len() {
            return Err(format!(
                "{} .refl files but only {} .expt file(s): give one .expt for each .refl",
                refls.len(),
                expts.len()
            ));
        }
        // In order; a .expt without a .refl uses the .refl of the same name.
        for (i, e) in expts.iter().enumerate() {
            let r = match refls.get(i) {
                Some(r) => r.clone(),
                None => partner(e, "refl")?,
            };
            pairs.push((e.clone(), r));
        }
    }

    Ok(Parsed::Files(
        pairs
            .into_iter()
            .map(|(e, r)| (absolute(&e), absolute(&r)))
            .collect(),
    ))
}

/// indexed.expt -> indexed.refl (or the other way), if that file exists.
fn partner(path: &Path, ext: &str) -> Result<PathBuf, String> {
    let p = path.with_extension(ext);
    if p.is_file() {
        Ok(p)
    } else {
        Err(format!(
            "no .{ext} file given for {} (and {} does not exist)",
            path.display(),
            p.display()
        ))
    }
}

/// Folder that relative paths on the command line are relative to. An
/// AppImage may run from another folder; it keeps the user's folder in OWD.
fn base_dir() -> PathBuf {
    std::env::var_os("OWD")
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_default()
}

fn absolute(p: &Path) -> String {
    std::fs::canonicalize(p)
        .unwrap_or_else(|_| p.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

/// Windows: the app has no console of its own, so --help / --version would
/// print nowhere. Write to the terminal it was started from instead.
#[cfg(windows)]
fn attach_console() {
    extern "system" {
        fn AttachConsole(process_id: u32) -> i32;
    }
    const ATTACH_PARENT_PROCESS: u32 = u32::MAX;
    unsafe {
        AttachConsole(ATTACH_PARENT_PROCESS);
    }
}

#[cfg(not(windows))]
fn attach_console() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn args(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    fn setup() -> PathBuf {
        let d = std::env::temp_dir().join(format!("rlv_cli_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        for f in ["imported.expt", "strong.refl", "indexed.expt", "indexed.refl", "lone.expt", "only.refl", "only.expt"] {
            fs::write(d.join(f), b"x").unwrap();
        }
        d
    }

    fn names(p: Parsed) -> Vec<(String, String)> {
        match p {
            Parsed::Files(v) => v
                .into_iter()
                .map(|(e, r)| {
                    (
                        Path::new(&e).file_name().unwrap().to_string_lossy().into(),
                        Path::new(&r).file_name().unwrap().to_string_lossy().into(),
                    )
                })
                .collect(),
            other => panic!("expected files, got {other:?}"),
        }
    }

    #[test]
    fn help_and_version() {
        let d = setup();
        assert_eq!(parse_args(&args(&["-h"]), &d), Ok(Parsed::Help));
        assert_eq!(parse_args(&args(&["--help"]), &d), Ok(Parsed::Help));
        assert_eq!(parse_args(&args(&["--version"]), &d), Ok(Parsed::Version));
        assert_eq!(parse_args(&args(&["-V"]), &d), Ok(Parsed::Version));
        assert_eq!(parse_args(&args(&["imported.expt", "--version"]), &d), Ok(Parsed::Version));
    }

    #[test]
    fn no_args_opens_nothing() {
        let d = setup();
        assert_eq!(parse_args(&args(&[]), &d), Ok(Parsed::Files(vec![])));
    }

    #[test]
    fn pairs() {
        let d = setup();
        assert_eq!(
            names(parse_args(&args(&["imported.expt", "strong.refl"]), &d).unwrap()),
            vec![("imported.expt".into(), "strong.refl".into())]
        );
        // either order
        assert_eq!(
            names(parse_args(&args(&["strong.refl", "imported.expt"]), &d).unwrap()),
            vec![("imported.expt".into(), "strong.refl".into())]
        );
        // partner by name
        assert_eq!(
            names(parse_args(&args(&["indexed.expt"]), &d).unwrap()),
            vec![("indexed.expt".into(), "indexed.refl".into())]
        );
        assert_eq!(
            names(parse_args(&args(&["indexed.refl"]), &d).unwrap()),
            vec![("indexed.expt".into(), "indexed.refl".into())]
        );
        // several pairs
        assert_eq!(
            names(parse_args(&args(&["imported.expt", "strong.refl", "indexed.expt", "indexed.refl"]), &d).unwrap()),
            vec![
                ("imported.expt".into(), "strong.refl".into()),
                ("indexed.expt".into(), "indexed.refl".into())
            ]
        );
        // absolute paths too
        let abs = d.join("indexed.expt").to_string_lossy().into_owned();
        assert_eq!(
            names(parse_args(&args(&[&abs]), Path::new("/")).unwrap()),
            vec![("indexed.expt".into(), "indexed.refl".into())]
        );
        // dials-style setting ignored
        assert_eq!(
            names(parse_args(&args(&["indexed.expt", "show_rotation_axis=True"]), &d).unwrap()),
            vec![("indexed.expt".into(), "indexed.refl".into())]
        );
    }

    #[test]
    fn mistakes() {
        let d = setup();
        assert!(parse_args(&args(&["--foo"]), &d).unwrap_err().contains("unknown option"));
        assert!(parse_args(&args(&["missing.expt"]), &d).unwrap_err().contains("no such file"));
        assert!(parse_args(&args(&["image.cbf"]), &d).unwrap_err().contains("not a .expt or .refl"));
        assert!(parse_args(&args(&["lone.expt"]), &d).unwrap_err().contains("no .refl file given"));
        assert!(parse_args(&args(&["strong.refl"]), &d).unwrap_err().contains("no .expt file given"));
        assert!(parse_args(&args(&["imported.expt", "strong.refl", "indexed.refl"]), &d)
            .unwrap_err()
            .contains("only 1 .expt"));
    }
}
