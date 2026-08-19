use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

const CLI_BIN: &str = if cfg!(target_os = "windows") { "flux.exe" } else { "flux" };

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub path: String,
    pub already_in_path: bool,
}

fn find_cli_binary(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 1. Production: bundled as flux-cli.exe to avoid colliding with the main app binary
    if let Ok(res_dir) = app.path().resource_dir() {
        let bundled = res_dir.join("flux-cli.exe");
        if bundled.exists() {
            return Ok(bundled);
        }
        // fallback: same name (non-Windows builds or future rename)
        let bundled2 = res_dir.join(CLI_BIN);
        if bundled2.exists() {
            return Ok(bundled2);
        }
    }

    // 2. Development: cargo build output relative to workspace
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("cannot determine exe directory")?;

    let dev_candidates = [
        exe_dir.join(format!("../../../flux-cli/target/release/{}", CLI_BIN)),
        exe_dir.join(format!("../../../flux-cli/target/debug/{}", CLI_BIN)),
    ];

    for path in &dev_candidates {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            if canonical.exists() {
                return Ok(canonical);
            }
        }
    }

    Err(
        "CLI binary not found. For development run `cargo build` in flux-cli/. \
         For production run `cargo build --release` in flux-cli/ before `cargo tauri build`."
            .to_string(),
    )
}

fn get_install_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("bin"))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
fn windows_path_script(dir: &str, remove: bool) -> String {
    // Se escribe en el registro en vez de usar
    // [Environment]::SetEnvironmentVariable: ese metodo devuelve el PATH ya
    // expandido, asi que reescribirlo convertiria entradas como
    // %USERPROFILE%\bin en rutas literales y dejaria el PATH del usuario
    // roto, ademas de cambiar el tipo de REG_EXPAND_SZ a REG_SZ.
    // DoNotExpandEnvironmentNames + ExpandString lo conservan intacto.
    const SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
$dir = '@DIR@'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
    $opts = [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames
    $current = $key.GetValue('Path', '', $opts)
    if ($null -eq $current) { $current = '' }
    $parts = @($current -split ';' | Where-Object { $_ -ne '' })
    $before = $parts.Count
    $changed = $false
    @MUTATE@
    if ($changed) {
        $kind = [Microsoft.Win32.RegistryValueKind]::ExpandString
        $key.SetValue('Path', ($parts -join ';'), $kind)
        Write-Output 'changed'
    } else {
        Write-Output 'unchanged'
    }
} finally {
    $key.Close()
}
"#;

    let mutate = if remove {
        "$parts = @($parts | Where-Object { $_ -ne $dir }); $changed = $parts.Count -ne $before"
    } else {
        "if ($parts -notcontains $dir) { $parts = @($parts) + $dir; $changed = $true }"
    };

    SCRIPT
        .replace("@DIR@", &dir.replace("'", "''"))
        .replace("@MUTATE@", mutate)
}

#[cfg(target_os = "windows")]
fn run_windows_path_script(script: &str) -> Result<bool, String> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
        .map_err(|e| format!("Failed to run PowerShell: {}", e))?;

    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(format!("PATH update failed: {}", err));
    }

    Ok(String::from_utf8_lossy(&out.stdout).trim() == "changed")
}

#[cfg(target_os = "windows")]
fn add_to_user_path(dir: &str) -> Result<bool, String> {
    run_windows_path_script(&windows_path_script(dir, false))
}

#[cfg(target_os = "windows")]
fn remove_from_user_path(dir: &str) -> Result<bool, String> {
    run_windows_path_script(&windows_path_script(dir, true))
}

#[cfg(not(target_os = "windows"))]
fn add_to_user_path(dir: &str) -> Result<bool, String> {
    // On macOS/Linux: append to ~/.zshrc and ~/.bashrc
    let export_line = format!("\nexport PATH=\"{}:$PATH\"\n", dir);
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;

    let mut added = false;
    for rc in &[".zshrc", ".bashrc", ".profile"] {
        let path = std::path::Path::new(&home).join(rc);
        if path.exists() {
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            if !content.contains(dir) {
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(&path)
                    .and_then(|mut f| { use std::io::Write; f.write_all(export_line.as_bytes()) })
                    .ok();
                added = true;
            }
        }
    }
    Ok(added)
}

#[cfg(not(target_os = "windows"))]
fn remove_from_user_path(dir: &str) -> Result<bool, String> {
    let export_line = format!("export PATH=\"{}:$PATH\"", dir);
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;

    let mut removed = false;
    for rc in &[".zshrc", ".bashrc", ".profile"] {
        let path = std::path::Path::new(&home).join(rc);
        let Ok(content) = std::fs::read_to_string(&path) else { continue };
        if !content.contains(&export_line) {
            continue;
        }
        let kept: Vec<&str> = content
            .lines()
            .filter(|l| l.trim() != export_line)
            .collect();
        if std::fs::write(&path, kept.join("
") + "
").is_ok() {
            removed = true;
        }
    }
    Ok(removed)
}

#[tauri::command]
pub async fn install_cli(app: tauri::AppHandle) -> Result<InstallResult, String> {
    let source = find_cli_binary(&app)?;
    let install_dir = get_install_dir(&app)?;

    std::fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Cannot create install dir: {}", e))?;

    let dest = install_dir.join(CLI_BIN);
    std::fs::copy(&source, &dest)
        .map_err(|e| format!("Failed to copy binary: {}", e))?;

    // Make executable on macOS/Linux
    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    let dir_str = install_dir.to_string_lossy().to_string();
    let added = add_to_user_path(&dir_str)?;

    Ok(InstallResult {
        path: dest.to_string_lossy().to_string(),
        already_in_path: !added,
    })
}

#[tauri::command]
pub fn get_cli_status(app: tauri::AppHandle) -> CliStatus {
    if let Ok(install_dir) = get_install_dir(&app) {
        let bin = install_dir.join(CLI_BIN);
        if bin.exists() {
            let version = std::process::Command::new(&bin)
                .arg("--version")
                .output()
                .ok()
                .filter(|o| o.status.success())
                .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

            return CliStatus {
                installed: true,
                path: Some(bin.to_string_lossy().to_string()),
                version,
            };
        }
    }

    CliStatus { installed: false, path: None, version: None }
}

#[tauri::command]
pub fn uninstall_cli(app: tauri::AppHandle) -> Result<(), String> {
    let install_dir = get_install_dir(&app)?;
    let bin = install_dir.join(CLI_BIN);
    if bin.exists() {
        std::fs::remove_file(&bin).map_err(|e| e.to_string())?;
    }
    // Sin esto, desinstalar dejaba la entrada del PATH para siempre.
    let _ = remove_from_user_path(&install_dir.to_string_lossy());
    Ok(())
}
