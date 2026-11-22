const GUPPY_CONFIG_RAW: &str = include_str!("../../src/lib/guppyConfig.js");

fn config_val(key: &str, fallback: &str) -> String {
    for line in GUPPY_CONFIG_RAW.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix(key) {
            if let Some((_, val)) = rest.split_once(':') {
                let clean = val.trim().trim_end_matches(',').trim_matches(|c| c == '\'' || c == '"');
                if !clean.is_empty() && !clean.contains('$') {
                    return clean.to_string();
                }
            }
        }
    }
    fallback.to_string()
}

fn host_ip() -> String {
    if let Some(start) = GUPPY_CONFIG_RAW.find("const HOST_IP = [") {
        let slice = &GUPPY_CONFIG_RAW[start..];
        if let Some(end) = slice.find(']') {
            let octets: Vec<&str> = slice[17..end]
                .split(',')
                .map(|s| s.trim().trim_matches(|c| c == '\'' || c == '"'))
                .filter(|s| !s.is_empty())
                .collect();
            if octets.len() == 4 {
                return octets.join(".");
            }
        }
    }
    "127.0.0.1".to_string()
}

use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::Manager;

const SERVER_SCRIPT: &str = include_str!("../../server/guppy-server.mjs");

fn is_port_open(addr_str: &str) -> bool {
    if let Ok(addrs) = addr_str.to_socket_addrs() {
        for addr in addrs {
            if TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok() {
                return true;
            }
        }
    }
    false
}

fn find_node_binary() -> String {
    for candidate in [
        "/opt/homebrew/bin/node",
        "/usr/local/bin/node",
        "/usr/bin/node",
    ] {
        if Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }
    "node".to_string()
}

#[tauri::command]
fn mount_shared_drive() -> Result<String, String> {
    if Path::new("/Volumes/4TB0-SEAGATE/jelly").exists() || Path::new("/Volumes/jelly").exists() {
        return Ok("Mounted".to_string());
    }
    let output = Command::new("osascript")
        .args([
            "-e",
            &format!("mount volume \"smb://{}@{}/{}\"", config_val("smbUser", "guppy"), host_ip(), config_val("smbShareName", "jelly")),
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() || Path::new("/Volumes/jelly").exists() {
        Ok("Mounted".to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![mount_shared_drive])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
            }

            let app_data_dir = app.path().app_data_dir().ok();
            let has_local_db = app_data_dir
                .as_ref()
                .map(|d| d.join("local_media.db").exists())
                .unwrap_or(false);

            std::thread::spawn(move || {
                if has_local_db {
                    // Host Mac (Mac #1): auto-start embedded LAN server on port 3456 if not already running
                    let local_addr: SocketAddr = "127.0.0.1:3456".parse().unwrap();
                    if TcpStream::connect_timeout(&local_addr, Duration::from_millis(250)).is_err() {
                        let script_path = "/tmp/guppy-server.mjs";
                        if std::fs::write(script_path, SERVER_SCRIPT).is_ok() {
                            let node_bin = find_node_binary();
                            let _ = Command::new(node_bin)
                                .arg(script_path)
                                .stdin(Stdio::null())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .spawn();
                        }
                    }
                } else if is_port_open(&format!("{}:{}", host_ip(), config_val("hostPort", "3456"))) || is_port_open(&format!("{}:{}", config_val("hostMdns", "localhost"), config_val("hostPort", "3456"))) {
                    // Client Mac (Mac #2): auto-mount /Volumes/jelly if not already mounted
                    if !Path::new("/Volumes/4TB0-SEAGATE/jelly").exists() && !Path::new("/Volumes/jelly").exists() {
                        let _ = Command::new("osascript")
                            .args([
                                "-e",
                                &format!("try\nmount volume \"smb://{}@{}/{}\"\nend try", config_val("smbUser", "guppy"), host_ip(), config_val("smbShareName", "jelly")),
                            ])
                            .stdin(Stdio::null())
                            .stdout(Stdio::null())
                            .stderr(Stdio::null())
                            .spawn();
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
