use std::{path::PathBuf, process::{Child, Command}, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, RunEvent,
};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const PORT: u16 = 47821;

struct Agent {
    child: Mutex<Option<Child>>,
    token: String,
}

#[derive(serde::Serialize)]
struct AgentConfig {
    port: u16,
    token: String,
}

/// The UI learns the (random, per-launch) local token through IPC. Provider API keys never pass through here.
#[tauri::command]
fn get_agent_config(state: tauri::State<Agent>) -> AgentConfig {
    AgentConfig { port: PORT, token: state.token.clone() }
}

fn spawn_agent(token: &str) -> Option<Child> {
    let root = std::env::var("YUNA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(".."));
    let mut cmd = Command::new("node");
    cmd.current_dir(&root)
        .args(["--import", "tsx", "agent/server.ts"])
        .env("YUNA_TOKEN", token)
        .env("YUNA_PORT", PORT.to_string());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map_err(|e| eprintln!("failed to start Yuna agent: {e}")).ok()
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        let chat = shortcut.mods.contains(Modifiers::SHIFT);
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("yuna-cmd", if chat { "chat" } else { "voice" });
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_agent_config])
        .setup(|app| {
            let token = uuid::Uuid::new_v4().to_string();
            // YUNA_NO_SPAWN=1 lets you run `npm run dev:agent` yourself (token must match: set YUNA_TOKEN).
            let child = if std::env::var("YUNA_NO_SPAWN").is_ok() { None } else { spawn_agent(&token) };
            app.manage(Agent { child: Mutex::new(child), token });

            let voice = MenuItem::with_id(app, "voice", "Start voice", true, None::<&str>)?;
            let chat = MenuItem::with_id(app, "chat", "Open chat", true, None::<&str>)?;
            let pause = MenuItem::with_id(app, "pause", "Pause / resume agent", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&voice, &chat, &pause, &settings, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Yuna")
                .menu(&menu)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "quit" => app.exit(0),
                    id => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                        let _ = app.emit("yuna-cmd", id);
                    }
                })
                .build(app)?;

            app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::Space))?;
            app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Yuna");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(a) = handle.try_state::<Agent>() {
                if let Some(mut c) = a.child.lock().unwrap().take() {
                    let _ = c.kill();
                }
            }
        }
    });
}
