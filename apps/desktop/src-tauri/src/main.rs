// Hide the console window in release builds; debug builds keep stdout/stderr.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    davinci_journey_desktop::run();
}
