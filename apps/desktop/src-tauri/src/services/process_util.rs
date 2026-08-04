//! Windows-friendly process spawning.
//!
//! The desktop app spawns `git`/`gh` subprocesses. In the packaged (release)
//! app there is no console, so spawned console-subsystem children would each
//! pop up a separate black terminal window. We create them with
//! `CREATE_NO_WINDOW` so they run silently.

use std::process::Command;

/// Create a command that runs without popping a console window.
#[cfg(target_os = "windows")]
pub fn silent_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut cmd = Command::new(program);
    // CREATE_NO_WINDOW = 0x08000000
    cmd.creation_flags(0x0800_0000);
    cmd
}

#[cfg(not(target_os = "windows"))]
pub fn silent_command(program: &str) -> Command {
    Command::new(program)
}
